import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  INVOICE_TAGLINE, formatInvoiceMoney, formatPlainAmount, templateBusinessLines, templateClientLines, templateFooter, templateHeadline,
  templateMetaRows, templatePaymentRows, templatePaymentsReceived, templateProjectDetails, templateTotalRows, type InvoiceView,
} from "../shared/invoice.js";

const W = 595.28; // A4 at 72dpi
const H = 841.89;
const M = 45;
const CW = W - M * 2;
const TOP = 52;
const FOOTER_SPACE = 70;

const INK = rgb(0.1, 0.1, 0.1);
const SOFT = rgb(0.24, 0.24, 0.24);
const MUTED = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.9, 0.9, 0.9);

/** The built-in PDF fonts only cover WinAnsi; map anything else to a safe equivalent so a client
 * name with an unusual character can never make PDF generation throw. */
export function pdfSafe(input: string | null | undefined): string {
  const replaced = (input ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/…/g, "...").replace(/\r/g, "").replace(/\t/g, " ");
  return Array.from(replaced).map((char) => {
    const code = char.codePointAt(0)!;
    if (char === "\n" || code === 0x2022 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return char;
    const stripped = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return /^[\x20-\x7e]+$/.test(stripped) ? stripped : "?";
  }).join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) { out.push(current); current = word; } else current = candidate;
    }
    out.push(current);
  }
  return out.length ? out : [""];
}

/**
 * The 45Creatives invoice / quotation template as an A4 PDF. Mirrors `InvoiceSheet` on the client;
 * both take their rows from the shared template helpers in shared/invoice.ts.
 */
export async function renderInvoicePdf(view: InvoiceView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const isQuote = view.kind === "quote";
  const docName = isQuote ? "Quotation" : "Invoice";
  const money = (value: number) => formatInvoiceMoney(value, view.currency);
  doc.setTitle(`${docName} ${pdfSafe(view.number)}`);
  doc.setProducer("45Creatives CRM");
  doc.setAuthor(pdfSafe(view.business.name));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - TOP;
  const newPage = () => { page = doc.addPage([W, H]); y = H - TOP; };
  const ensure = (height: number) => { if (y - height < FOOTER_SPACE) { newPage(); return true; } return false; };
  const text = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular, color = INK, align: "left" | "right" | "center" = "left") => {
    const safe = pdfSafe(value);
    const width = font.widthOfTextAtSize(safe, size);
    const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    page.drawText(safe, { x: left, y: baseline, size, font, color });
  };
  /** Right-aligned amounts. A leading "– " is drawn as a real en dash (WinAnsi has it) rather than flattened to a hyphen. */
  const amount = (value: string, right: number, baseline: number, size: number, font: PDFFont = regular) => {
    const minus = value.startsWith("– ");
    const rest = pdfSafe(minus ? value.slice(2) : value);
    const restWidth = font.widthOfTextAtSize(rest, size);
    page.drawText(rest, { x: right - restWidth, y: baseline, size, font, color: INK });
    if (minus) page.drawText("– ", { x: right - restWidth - font.widthOfTextAtSize("– ", size), y: baseline, size, font, color: INK });
  };
  const rule = (x1: number, x2: number, at: number, thickness = 0.6, color = RULE) => page.drawLine({ start: { x: x1, y: at }, end: { x: x2, y: at }, thickness, color });

  const body = 9.5;
  const lead = 14.5;

  // --- Title and brand ----------------------------------------------------------------------
  const name = pdfSafe(view.business.name) || "45Creatives";
  text(docName, M, y - 26, 27, bold);
  text(name, W - M, y - 16, 17, bold, INK, "right");
  // Letter-spaced tagline, right-aligned under the name.
  const tagline = pdfSafe(INVOICE_TAGLINE);
  const tagSize = 6.3;
  const tracking = 1.5;
  let tx = W - M - (regular.widthOfTextAtSize(tagline, tagSize) + tracking * (tagline.length - 1));
  for (const char of tagline) { page.drawText(char, { x: tx, y: y - 30, size: tagSize, font: regular, color: MUTED }); tx += regular.widthOfTextAtSize(char, tagSize) + tracking; }
  y -= 26 + 30;

  // --- Invoice number / dates ---------------------------------------------------------------
  const metaRows = templateMetaRows(view);
  // The value column starts after the widest label ("Quotation number" is wider than "Invoice number").
  const metaOffset = Math.max(83, ...metaRows.map((row) => bold.widthOfTextAtSize(pdfSafe(row.label), body) + 14));
  for (const row of metaRows) {
    const lines = wrap(row.value, regular, body, CW - metaOffset);
    text(row.label, M, y - 9, body, bold);
    lines.forEach((line, i) => text(line, M + metaOffset, y - 9 - i * 12.5, body));
    y -= 4.3 + lines.length * 12.5;
  }
  y -= 26;

  // --- From / Bill to -----------------------------------------------------------------------
  const colX = M + CW / 2 + 0.5;
  const colWidth = CW / 2 - 12;
  const party = (title: string, lines: string[]) => [{ text: title, font: bold }, ...lines.flatMap((line) => wrap(line, regular, body, colWidth).map((part) => ({ text: part, font: regular })))];
  const from = party(name, templateBusinessLines(view));
  const to = party(isQuote ? "Prepared for" : "Bill to", templateClientLines(view));
  const partyRows = Math.max(from.length, to.length);
  ensure(partyRows * lead + 10);
  const partyBaseline = (i: number) => y - 9 - (i === 0 ? 0 : i * lead + 2);
  from.forEach((line, i) => text(line.text, M, partyBaseline(i), body, line.font));
  to.forEach((line, i) => text(line.text, colX, partyBaseline(i), body, line.font));
  y -= partyRows * lead + 2 + 28;

  // --- "KSh 0.00 due DD MMM YYYY" and project ------------------------------------------------
  const headline = templateHeadline(view);
  const projectDetails = templateProjectDetails(view);
  ensure(60);
  text(`${headline.amount} ${headline.text}`, M, y - 13, 13.5, bold);
  y -= 13 + 8;
  if (view.project.name.trim()) {
    for (const line of wrap(`Project: ${view.project.name.trim()}`, regular, body, CW)) { y -= lead - 2; text(line, M, y, body); }
  }
  if (projectDetails.length) {
    for (const line of wrap(projectDetails.join(" · "), regular, 8.5, CW)) { y -= 12; text(line, M, y, 8.5, regular, MUTED); }
  }
  y -= 24;

  // --- Line items ---------------------------------------------------------------------------
  const cols = { qty: M + CW * 0.6, unit: M + CW * 0.8, amount: W - M };
  const descWidth = cols.qty - 30 - M;
  const tableHeader = () => {
    text("Description", M, y - 8, 8.8);
    text("Qty", cols.qty, y - 8, 8.8, regular, INK, "center");
    text("Unit price", cols.unit, y - 8, 8.8, regular, INK, "right");
    text("Amount", cols.amount, y - 8, 8.8, regular, INK, "right");
    y -= 13;
    rule(M, W - M, y, 1, INK);
  };
  ensure(13 + 30);
  tableHeader();
  view.items.forEach((item) => {
    const descLines = wrap(item.description, regular, body, descWidth);
    const rowHeight = Math.max(28.5, descLines.length * 12.5 + 16);
    if (ensure(rowHeight)) tableHeader();
    descLines.forEach((line, i) => text(line, M, y - 17 - i * 12.5, body));
    const qty = Number.isInteger(item.quantity) ? String(item.quantity) : String(Number(item.quantity.toFixed(2)));
    text(qty, cols.qty, y - 17, body, regular, INK, "center");
    amount(money(item.unitPrice), cols.unit, y - 17, body);
    amount(money(item.amount), cols.amount, y - 17, body);
    y -= rowHeight;
    rule(M, W - M, y);
  });
  y -= 14;

  // --- Totals: light rules between rows, a dark rule above the final one ----------------------
  const totals = templateTotalRows(view);
  const totalsX = M + CW * 0.52;
  ensure(totals.length * 19.5 + 6);
  rule(totalsX, W - M, y);
  totals.forEach((row, index) => {
    const final = index === totals.length - 1;
    const font = final ? bold : regular;
    if (final) { rule(totalsX, W - M, y, 1, INK); y -= 2; }
    text(row.label, totalsX, y - 13, body, font);
    amount(row.value, W - M, y - 13, body, font);
    y -= 19.5;
    if (index < totals.length - 2) rule(totalsX, W - M, y);
  });
  y -= 24;

  // --- How to pay / Next steps --------------------------------------------------------------
  const valueX = M + 50;
  if (isQuote) {
    const next = view.decision
      ? `${view.status === "ACCEPTED" ? "Accepted" : "Declined"} by ${view.decision.by} on ${view.decision.at}.${view.decision.note ? ` Note: ${view.decision.note}` : ""}`
      : `Accept this quotation online with the link you received, or reply to confirm. Please quote ${view.number} in any correspondence.`;
    const lines = wrap(next, regular, body, CW);
    ensure(20 + lines.length * lead);
    text("Next steps", M, y - 9, body, bold);
    y -= 9 + 3;
    for (const line of lines) { y -= lead; text(line, M, y, body); }
  } else {
    const rows = templatePaymentRows(view).map((row) => ({ label: row.label, lines: wrap(row.value, regular, body, CW - (valueX - M)) }));
    const extra = view.currency !== "KES" ? wrap(`Payments in Kenya shillings are credited at KSh ${formatPlainAmount(view.exchangeRate)} per ${view.currency}.`, regular, 8.5, CW) : [];
    ensure(22 + Math.max(1, rows.reduce((sum, row) => sum + row.lines.length, 0)) * 16.8 + extra.length * 12);
    text("How to pay", M, y - 9, body, bold);
    y -= 9 + 3;
    if (!rows.length) { y -= 16.8; text("Payment details available on request.", M, y, body); }
    for (const row of rows) {
      y -= 16.8;
      text(row.label, M + 2, y, body, regular, SOFT);
      row.lines.forEach((line, i) => text(line, valueX, y - i * 12.5, body));
      y -= (row.lines.length - 1) * 12.5;
    }
    for (const line of extra) { y -= 12; text(line, M, y, 8.5, regular, MUTED); }
    // Payments received: date, then method, M-Pesa code / reference and amount.
    const received = templatePaymentsReceived(view);
    if (received.length) {
      const dateWidth = 62;
      const receivedRows = received.map((row) => ({ label: row.label, lines: wrap(row.value, regular, body, CW - dateWidth) }));
      y -= 16;
      ensure(14 + receivedRows.reduce((sum, row) => sum + row.lines.length, 0) * 16.8);
      text("Payments received", M, y - 9, body, bold);
      y -= 9 + 3;
      for (const row of receivedRows) {
        ensure(16.8 * row.lines.length);
        y -= 16.8;
        text(row.label, M + 2, y, body, regular, SOFT);
        row.lines.forEach((line, i) => text(line, M + dateWidth, y - i * 12.5, body));
        y -= (row.lines.length - 1) * 12.5;
      }
    }
  }
  y -= 18;

  // --- Closing note and any special instructions ---------------------------------------------
  const notes = [view.terms.join(" "), view.notes.trim()].filter(Boolean);
  notes.forEach((note, index) => {
    if (index) y -= 6;
    for (const line of wrap(note, regular, 8.4, CW)) { ensure(12); y -= 11.5; text(line, M, y, 8.4, regular, SOFT); }
  });

  // --- Page footers -------------------------------------------------------------------------
  const footer = pdfSafe(templateFooter(view));
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, thickness: 0.6, color: RULE });
    p.drawText(footer, { x: M, y: 40, size: 8.4, font: regular, color: SOFT });
    const label = `Page ${index + 1} of ${pages.length}`;
    p.drawText(label, { x: W - M - regular.widthOfTextAtSize(label, 8.4), y: 40, size: 8.4, font: regular, color: SOFT });
  });

  return doc.save();
}
