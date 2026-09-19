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

// ARGB fill colors, matching the row-highlight colors used in the on-page table
// (css/styles.css --highlight-architecture / --highlight-others / --highlight-latest / --highlight-filled).
const XLSX_HIGHLIGHT_COLORS = {
  architecture: "FFFFF2CC",
  others: "FFF8CECE",
  latest: "FFFFF59D",
  filled: "FFD9EAD3"
};

/**
 * Downloads rows as a real .xlsx workbook with the highlighted rows kept as
 * actual colored cells (a plain CSV can't carry cell colors). Expects
 * ExcelJS to be loaded globally via a <script> tag before this module runs.
 *
 * @param headers        column headers, in order
 * @param rows           array of row objects keyed by header
 * @param highlights     array (same length/order as rows) of "architecture" | "others" | "latest" | null
 * @param filename       download filename
 * @param sheetName      worksheet title (defaults to "Categorized" for existing callers)
 */
export async function downloadHighlightedXlsx(headers, rows, highlights, filename, sheetName = "Categorized") {
  const workbook = new window.ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(40, Math.max(14, h.length + 4))
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  rows.forEach((row, i) => {
    const excelRow = sheet.addRow(headers.map((h) => row[h] ?? ""));
    const color = XLSX_HIGHLIGHT_COLORS[highlights[i]];
    if (color) {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
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
 * Same idea as downloadHighlightedXlsx, but for tools that fill in or change individual
 * cells rather than categorize whole rows (e.g. the location-fill tool only touches the
 * handful of cells it actually populated).
 *
 * @param headers          column headers, in order
 * @param rows             array of row objects keyed by header
 * @param cellHighlights   array (same length/order as rows) of Set<header> — which cells in
 *                         that row to highlight; an empty/missing Set highlights nothing
 * @param filename         download filename
 * @param sheetName        worksheet title
 * @param highlightKey     which XLSX_HIGHLIGHT_COLORS entry to use (defaults to "filled")
 */
export async function downloadCellHighlightedXlsx(
  headers,
  rows,
  cellHighlights,
  filename,
  sheetName = "Sheet1",
  highlightKey = "filled"
) {
  const workbook = new window.ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(40, Math.max(14, h.length + 4))
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const color = XLSX_HIGHLIGHT_COLORS[highlightKey];

  rows.forEach((row, i) => {
    const excelRow = sheet.addRow(headers.map((h) => row[h] ?? ""));
    const highlighted = cellHighlights[i];
    if (color && highlighted && highlighted.size) {
      headers.forEach((h, colIdx) => {
        if (highlighted.has(h)) {
          excelRow.getCell(colIdx + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
        }
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
