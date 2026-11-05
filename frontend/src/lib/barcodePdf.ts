// Builds a printable A4 PDF sheet of Code 128 barcode labels (3 columns x 8 rows per page).
// The PDF is written directly (vector bars, built-in Helvetica/Courier fonts), so no PDF library is needed.

import { encodeCode128 } from './code128';

export interface BarcodeLabel {
  name: string; // product name, printed above the bars
  code: string; // barcode or SKU, encoded and printed below the bars
  detail?: string; // small line under the code, e.g. "Aarong Dairy · 1 Dozen Box · Tk 160.00"
}

const PAGE_W = 595.28; // A4 in points
const PAGE_H = 841.89;
const MARGIN = 28;
const FOOTER = 16;
const COLS = 3;
const ROWS = 8;
const CELL_W = (PAGE_W - 2 * MARGIN) / COLS;
const CELL_H = (PAGE_H - 2 * MARGIN - FOOTER) / ROWS;
const MAX_MODULE = 1.3; // points per bar module (about 0.46 mm)
const BAR_H = 40;

// Built-in PDF fonts only cover Latin-1; keep plain ASCII so byte offsets equal string lengths.
const pdfText = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\()]/g, (c) => `\\${c}`);

// Helvetica glyphs average about 0.52 em; trim so the name stays inside its cell.
const fitText = (s: string, size: number, width: number) => {
  const max = Math.floor(width / (size * 0.52));
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s;
};

const n = (v: number) => (Math.round(v * 100) / 100).toString();

const labelOps = (label: BarcodeLabel, x: number, y: number): string => {
  const ops: string[] = [];
  const top = y + CELL_H;
  const inner = CELL_W - 16;

  // Light cutting guide around the label.
  ops.push(`0.85 G 0.4 w ${n(x + 2)} ${n(y + 2)} ${n(CELL_W - 4)} ${n(CELL_H - 4)} re S`);

  // Product name.
  const name = pdfText(fitText(label.name, 7.5, inner));
  ops.push(`0 g BT /F1 7.5 Tf ${n(x + 8)} ${n(top - 15)} Td (${name}) Tj ET`);

  // Bars, centered; the module width shrinks for long codes so the quiet zones still fit.
  const { bars, width } = encodeCode128(label.code);
  const module = Math.min(MAX_MODULE, inner / width);
  const barsX = x + (CELL_W - width * module) / 2;
  const barsY = top - 22 - BAR_H;
  for (const [bx, bw] of bars) ops.push(`${n(barsX + bx * module)} ${n(barsY)} ${n(bw * module)} ${BAR_H} re`);
  ops.push('f');

  // Code in Courier (fixed 0.6 em per character), centered under the bars.
  const codeSize = 9;
  const codeText = pdfText(label.code);
  const codeX = x + (CELL_W - codeText.length * codeSize * 0.6) / 2;
  ops.push(`BT /F2 ${codeSize} Tf ${n(codeX)} ${n(barsY - 10)} Td (${codeText}) Tj ET`);

  if (label.detail) {
    const detail = pdfText(fitText(label.detail, 6, inner));
    ops.push(`0.4 g BT /F1 6 Tf ${n(x + 8)} ${n(barsY - 20)} Td (${detail}) Tj ET`);
  }
  return ops.join('\n');
};

/** Returns the PDF file as a Blob. Labels whose code can't be encoded must be filtered out by the caller. */
export function buildBarcodePdf(labels: BarcodeLabel[], title: string): Blob {
  const perPage = COLS * ROWS;
  const pageCount = Math.max(1, Math.ceil(labels.length / perPage));

  const contents: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    const ops: string[] = [];
    labels.slice(p * perPage, (p + 1) * perPage).forEach((label, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      ops.push(labelOps(label, MARGIN + col * CELL_W, PAGE_H - MARGIN - (row + 1) * CELL_H));
    });
    const footer = pdfText(`${title} - page ${p + 1} of ${pageCount}`);
    ops.push(`0.4 g BT /F1 7 Tf ${MARGIN} ${MARGIN - 6} Td (${footer}) Tj ET`);
    contents.push(ops.join('\n'));
  }

  // Objects: 1 catalog, 2 page tree, 3-4 fonts, then a page + content stream pair per page.
  const objects: string[] = [];
  const pageIds = contents.map((_, i) => 5 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  contents.forEach((stream, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return new Blob([pdf], { type: 'application/pdf' });
}
