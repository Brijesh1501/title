// GET /api/linkedin/status?id=<snapshotId>
// Proxies Bright Data's Monitor Progress endpoint. Status is one of:
// starting | running | ready | failed | canceled.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.BRIGHTDATA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing the BRIGHTDATA_API_KEY environment variable." });
    return;
  }

  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Missing "id" query parameter.' });
    return;
  }

  try {
    const response = await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(response.status).json({ error: data.error || data.message || "Bright Data rejected the progress request.", details: data });
      return;
    }

    res.status(200).json({ status: data.status, progress: data.progress ?? null });
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach Bright Data: ${err.message}` });
  }
}
