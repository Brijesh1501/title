import { supabase } from "../supabaseClient.js";

export const DEFAULT_TITLE_LEVEL = "Staff/IC";
export const DEFAULT_RESP_AREA = "Others";
export const DEFAULT_DEPT_FUNCTION = "Operations and Others";

const ARCHITECTURE_TEST = /\barchitecture\b/i;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds one case-insensitive, word-boundary regex out of a rule's keyword list,
// e.g. ["ceo", "co-founder"] -> /\b(?:ceo|co-founder)\b/i
function buildMatcher(keywords) {
  const escaped = (keywords || []).filter(Boolean).map(escapeRegExp);
  if (!escaped.length) return null;
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i");
}

/** Fetches active rules from Supabase, grouped by rule_type, ordered by priority. */
export async function fetchTaxonomyRules() {
  const { data, error } = await supabase
    .from("job_title_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) throw error;

  const titleLevelRules = data
    .filter((r) => r.rule_type === "title_level")
    .map((r) => ({ ...r, matcher: buildMatcher(r.keywords) }))
    .filter((r) => r.matcher);

  const respAreaRules = data
    .filter((r) => r.rule_type === "responsibility_area")
    .map((r) => ({ ...r, matcher: buildMatcher(r.keywords) }))
    .filter((r) => r.matcher);

  return { titleLevelRules, respAreaRules };
}

/**
 * Applies the ordered rule sets to a single title, first match wins per set —
 * same semantics as the original Apps Script if/else if chain.
 */
export function mapTitleToTaxonomy(title, { titleLevelRules, respAreaRules }) {
  const cleanTitle = String(title || "");

  let titleLevel = DEFAULT_TITLE_LEVEL;
  for (const rule of titleLevelRules) {
    if (rule.matcher.test(cleanTitle)) {
      titleLevel = rule.label;
      break;
    }
  }

  let respArea = DEFAULT_RESP_AREA;
  let deptFunction = DEFAULT_DEPT_FUNCTION;
  for (const rule of respAreaRules) {
    if (rule.matcher.test(cleanTitle)) {
      respArea = rule.label;
      deptFunction = rule.dept_function || deptFunction;
      break;
    }
  }

  return { respArea, titleLevel, deptFunction };
}

/** Highlight tag for a processed title, mirrors the Apps Script highlight rules. */
export function highlightFor(title, respArea) {
  if (ARCHITECTURE_TEST.test(String(title || ""))) return "architecture";
  if (respArea === DEFAULT_RESP_AREA) return "others";
  return null;
}

/** Categorizes a full list of raw title strings in one pass. */
export function categorizeTitles(titles, ruleSets) {
  return titles.map((rawTitle) => {
    const title = String(rawTitle || "").trim();
    if (!title) {
      return { title, respArea: "", titleLevel: "", deptFunction: "", highlight: null };
    }
    const { respArea, titleLevel, deptFunction } = mapTitleToTaxonomy(title, ruleSets);
    return { title, respArea, titleLevel, deptFunction, highlight: highlightFor(title, respArea) };
  });
}
