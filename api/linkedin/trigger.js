// POST /api/linkedin/trigger
// Body: { urls: string[] }
// Starts a Bright Data LinkedIn Profiles dataset job and returns its snapshot id.
//
// This exists so the Bright Data API key never has to appear in code that ships to the
// browser. It's read here from a server-side environment variable instead — set these in
// the Vercel project (Settings -> Environment Variables), never committed to the repo:
//
//   BRIGHTDATA_API_KEY     required — your Bright Data API token
//   BRIGHTDATA_DATASET_ID  optional — defaults to Bright Data's public LinkedIn Profiles
//                          dataset id below (this id isn't secret, only the API key is)

const DEFAULT_DATASET_ID = "gd_l1viktl72bvl7bjuj0"; // Bright Data: LinkedIn Profiles dataset
const MAX_URLS_PER_REQUEST = 2000; // sanity cap; Bright Data's own limit is a 1 GB input file

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing the BRIGHTDATA_API_KEY environment variable. Set it in the Vercel project\'s Settings -> Environment Variables, then redeploy.'
    });
    return;
  }

  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: 'Request body must include a non-empty "urls" array.' });
    return;
  }
  if (urls.length > MAX_URLS_PER_REQUEST) {
    res.status(400).json({ error: `Too many URLs in one request (max ${MAX_URLS_PER_REQUEST}). Split into smaller batches.` });
    return;
  }

  const datasetId = process.env.BRIGHTDATA_DATASET_ID || DEFAULT_DATASET_ID;

  try {
    const response = await fetch(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(urls.map((url) => ({ url })))
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(response.status).json({ error: data.error || data.message || "Bright Data rejected the trigger request.", details: data });
      return;
    }
    if (!data.snapshot_id) {
      res.status(502).json({ error: "Bright Data didn't return a snapshot id.", details: data });
      return;
    }

    res.status(200).json({ snapshotId: data.snapshot_id, urlCount: urls.length });
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach Bright Data: ${err.message}` });
  }
}
