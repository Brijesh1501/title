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

export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: reject
    });
  });
}
