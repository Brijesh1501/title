// Ported from the original fillMissingLocationData() Apps Script. It read a "TimeZone"
// reference sheet, cleaned City/State/Country text down to a matchable key, and used that to
// fill blank State/Country/Region/Timezone cells in the main sheet without overwriting
// anything already filled in. The reference table now lives in Supabase (timezone_lookup,
// admin-editable) and the "main sheet" is whatever CSV gets uploaded.
//
// One behavior is intentionally extended, not just ported: the original built a per-City
// lookup map (mapByCity) but its match priority only ever checked State, then Country — City
// was never actually consulted. Here, when the uploaded file has a city column, City is tried
// first (the most specific signal available) before falling back to State, then Country. This
// can be turned off via the `matchByCity` option to reproduce the original's exact behavior.

import { supabase } from "../supabaseClient.js";

export async function fetchTimezoneLookup() {
  const { data, error } = await supabase
    .from("timezone_lookup")
    .select("*")
    .order("country", { ascending: true })
    .order("state", { ascending: true })
    .order("city", { ascending: true });

  if (error) throw error;
  return data;
}

// US state name <-> 2-letter code, verbatim from the original script.
const STATE_MAP = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo",
  montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh",
  oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
  "district of columbia": "dc"
};

const PREFIXES = [
  /^(greater|metropolitan|metro|city of|state of|commonwealth of|municipality of|village of|town of|borough of|county of)\s+/i,
  /^(north|northern|northeast|northwest|south|southern|southeast|southwest|east|eastern|west|western|upstate|downstate|central|mid-atlantic|lower|upper|inner|outer)\s+/i,
  /^(port|fort|saint|st\.|mount|mt\.)\s+/i
];

const SUFFIXES = [
  /\s+(metropolitan area|metro area|metroplex|msa|csa|pmsa)$/i,
  /\s+(area|region|corridor|valley|basin|coast|tri-state area|tri-county area|bay area|peninsula)$/i,
  /\s+(township|county|parish|borough|municipality|cdp|district|precinct|ward|unincorporated)$/i,
  /\s+(downtown|midtown|uptown|suburbs|heights|hills|ridge|plateau|harbor|sound|plains)$/i
];

/** Strips administrative/directional/regional prefixes and suffixes, verbatim port. */
export function cleanPureLocation(val, isState = false) {
  if (val == null || val === "") return "";

  let text = String(val).trim();
  PREFIXES.forEach((p) => { text = text.replace(p, ""); });
  SUFFIXES.forEach((s) => { text = text.replace(s, ""); });
  text = text.trim().toLowerCase();

  if (isState && STATE_MAP[text]) return STATE_MAP[text];
  return text;
}

/** Builds City/State/Country lookup maps from timezone_lookup rows, first-match-wins. */
export function buildLookupMaps(records) {
  const mapByCity = {};
  const mapByState = {};
  const mapByCountry = {};

  records.forEach((record) => {
    const cKey = cleanPureLocation(record.city);
    const sKey = cleanPureLocation(record.state, true);
    const coKey = cleanPureLocation(record.country);

    if (cKey && !mapByCity[cKey]) mapByCity[cKey] = record;
    if (sKey && !mapByState[sKey]) mapByState[sKey] = record;
    if (coKey && !mapByCountry[coKey]) mapByCountry[coKey] = record;
  });

  return { mapByCity, mapByState, mapByCountry };
}

// Recognized header spellings for each field the main CSV might use — matches the original
// script's "column placement independent" behavior, extended to tolerate a few common
// header variants rather than one exact string per field.
const MAIN_HEADER_ALIASES = {
  city: ["primary city", "city"],
  state: ["primary state/province", "state/province", "state"],
  country: ["primary country", "country"],
  region: ["region/geography", "region"],
  timezone: ["timezone", "time zone"]
};

function findHeader(headers, aliases) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const alias of aliases) {
    const i = lower.indexOf(alias);
    if (i !== -1) return headers[i];
  }
  return null;
}

/** Maps the uploaded CSV's actual headers onto city/state/country/region/timezone. */
export function resolveMainColumns(headers) {
  return {
    city: findHeader(headers, MAIN_HEADER_ALIASES.city),
    state: findHeader(headers, MAIN_HEADER_ALIASES.state),
    country: findHeader(headers, MAIN_HEADER_ALIASES.country),
    region: findHeader(headers, MAIN_HEADER_ALIASES.region),
    timezone: findHeader(headers, MAIN_HEADER_ALIASES.timezone)
  };
}

/**
 * Core of the port. For every row that's missing at least one of
 * State/Country/Region/Timezone, finds the best lookup match and fills only the blank
 * fields — never overwrites a value that's already there, same as the original.
 *
 * @param rows        array of row objects keyed by CSV header
 * @param mainCols    resolved columns, from resolveMainColumns(headers)
 * @param lookupMaps  from buildLookupMaps(timezone_lookup rows)
 * @param options.matchByCity  try a City match before State/Country when a city column is
 *   present (default true). Set false to reproduce the original script's exact priority
 *   (State, then Country only).
 *
 * @returns { rows: <rows with blanks filled>, filledCells: Set<header>[], stats }
 */
export function fillMissingLocationData(rows, mainCols, lookupMaps, options = {}) {
  const matchByCity = options.matchByCity !== false;
  const { mapByCity, mapByState, mapByCountry } = lookupMaps;

  const stats = { rowsExamined: rows.length, rowsAlreadyComplete: 0, rowsUpdated: 0, rowsNotFilled: 0 };
  const filledCells = rows.map(() => new Set());

  const outputRows = rows.map((row, i) => {
    const next = { ...row };

    const curState = mainCols.state ? row[mainCols.state] : "";
    const curCountry = mainCols.country ? row[mainCols.country] : "";
    const curRegion = mainCols.region ? row[mainCols.region] : "";
    const curTimezone = mainCols.timezone ? row[mainCols.timezone] : "";

    if (curState && curCountry && curRegion && curTimezone) {
      stats.rowsAlreadyComplete += 1;
      return next;
    }

    let match = null;
    if (matchByCity && mainCols.city) {
      match = mapByCity[cleanPureLocation(row[mainCols.city])] || null;
    }
    if (!match) match = mapByState[cleanPureLocation(curState, true)] || null;
    if (!match) match = mapByCountry[cleanPureLocation(curCountry)] || null;

    if (!match) {
      stats.rowsNotFilled += 1;
      return next;
    }

    let changed = false;
    if (mainCols.state && !curState && match.state) {
      next[mainCols.state] = match.state;
      filledCells[i].add(mainCols.state);
      changed = true;
    }
    if (mainCols.country && !curCountry && match.country) {
      next[mainCols.country] = match.country;
      filledCells[i].add(mainCols.country);
      changed = true;
    }
    if (mainCols.region && !curRegion && match.region) {
      next[mainCols.region] = match.region;
      filledCells[i].add(mainCols.region);
      changed = true;
    }
    if (mainCols.timezone && !curTimezone && match.timezone) {
      next[mainCols.timezone] = match.timezone;
      filledCells[i].add(mainCols.timezone);
      changed = true;
    }

    if (changed) stats.rowsUpdated += 1;
    else stats.rowsNotFilled += 1;

    return next;
  });

  return { rows: outputRows, filledCells, stats };
}
