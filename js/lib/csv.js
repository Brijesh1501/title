// Expects PapaParse to be loaded globally via a <script> tag before this module runs
// (see the CDN <script> in each HTML page). Keeps this project dependency-free of any
// bundler — plain <script src="https://cdn.jsdelivr.net/npm/papaparse@.../papaparse.min.js">.

export function downloadCsv(rows, filename) {
  const csv = window.Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Parses a CSV file of any size. Streams the file in chunks so the tab never
 * blocks/looks "stuck" on large files (thousands of rows), and reports
 * progress via onProgress({ rowsParsed, percent }). All rows are kept —
 * nothing is truncated or capped.
 */
export function parseCsvFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const rows = [];

    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      worker: true, // parse off the main thread so the UI stays responsive
      chunk: (results, parser) => {
        if (results.errors && results.errors.length) {
          // Keep going — a stray malformed line shouldn't drop the rest of the file.
          console.warn("CSV chunk parse warnings:", results.errors);
        }
        rows.push(...results.data);
        if (onProgress) {
          const percent = file.size ? Math.min(100, Math.round((results.meta.cursor / file.size) * 100)) : null;
          onProgress({ rowsParsed: rows.length, percent });
        }
      },
      complete: () => resolve(rows),
      error: reject
    });
  });
}
