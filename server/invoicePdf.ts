import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import {
  INVOICE_TAGLINE, formatInvoiceMoney, formatPlainAmount, templateBanner, templateBillTo, templateFooter, templateFrom,
  templateMetaRows, templatePaymentRows, templatePaymentsReceived, templateTotalRows, type InvoiceView, type TemplateParty, type TemplateRow,
} from "../shared/invoice.js";

const W = 595.28; // A4 at 72dpi
const H = 841.89;
const M = 48;
const CW = W - M * 2;
const TOP = 46;
const FOOTER_SPACE = 74;

const INK = rgb(0.067, 0.067, 0.067);
const SOFT = rgb(0.24, 0.24, 0.24);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.9, 0.9, 0.9);
const RED = rgb(0.847, 0.106, 0.133);
const WHITE = rgb(1, 1, 1);
const PANEL = rgb(0.957, 0.957, 0.957);
const PANEL_RULE = rgb(0.886, 0.886, 0.886);
const PINK = rgb(0.992, 0.933, 0.933);
const ON_DARK = rgb(0.62, 0.62, 0.62);

/** One line of a stacked text block; `step` is the drop from the previous baseline. */
type Line = { text: string; font: PDFFont; size: number; color: Color; step: number };

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
  const text = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular, color: Color = INK) => {
    page.drawText(pdfSafe(value), { x, y: baseline, size, font, color });
  };
  /** Left-aligned amounts. A leading "– " is drawn as a real en dash (WinAnsi has it) rather than flattened to a hyphen. */
  const amount = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular) => {
    const minus = value.startsWith("– ");
    if (minus) page.drawText("– ", { x, y: baseline, size, font, color: INK });
    const offset = minus ? font.widthOfTextAtSize("– ", size) : 0;
    page.drawText(pdfSafe(minus ? value.slice(2) : value), { x: x + offset, y: baseline, size, font, color: INK });
  };
  const rule = (x1: number, x2: number, at: number, thickness = 0.6, color: Color = RULE) => page.drawLine({ start: { x: x1, y: at }, end: { x: x2, y: at }, thickness, color });
  const vrule = (x: number, top: number, height: number) => page.drawLine({ start: { x, y: top }, end: { x, y: top - height }, thickness: 0.6, color: PANEL_RULE });
  const box = (x: number, top: number, width: number, height: number, color: Color, borderColor?: Color) =>
    page.drawRectangle({ x, y: top - height, width, height, color, ...(borderColor ? { borderColor, borderWidth: 0.6 } : {}) });
  const block = (value: string, font: PDFFont, size: number, color: Color, width: number, firstStep: number, step: number): Line[] =>
    wrap(value, font, size, width).map((part, i) => ({ text: part, font, size, color, step: i ? step : firstStep }));
  const linesHeight = (lines: Line[]) => lines.reduce((sum, line) => sum + line.step, 0);
  const drawLines = (lines: Line[], x: number, firstBaseline: number) => {
    let baseline = firstBaseline;
    for (const line of lines) { baseline -= line.step; text(line.text, x, baseline, line.size, line.font, line.color); }
  };

  const label = 6.8;
  const body = 8.6;

  // --- Brand and title on the left, tagline and number on the right, over a red rule ----------
  const sideX = M + CW * 0.64;
  text(templateFrom(view).name, M, y - 18, 19, bold);
  text(docName.toUpperCase(), M, y - 54, 31, bold);
  text(INVOICE_TAGLINE, sideX, y - 14, 7.2, bold, RED);
  wrap(view.number, bold, 9.2, W - M - sideX).forEach((line, i) => text(line, sideX, y - 46 + i * 11, 9.2, bold));
  y -= 66;
  rule(M, W - M, y, 1.2, RED);
  y -= 20;

  // --- Grey strip: issue date, due date, project ----------------------------------------------
  const meta = templateMetaRows(view);
  const cellW = CW / meta.length;
  const cellLines = meta.map((row) => wrap(row.value, bold, 9.2, cellW - 20));
  const metaH = 31 + Math.max(...cellLines.map((lines) => lines.length)) * 11.5;
  box(M, y, CW, metaH, PANEL, PANEL_RULE);
  meta.forEach((row, i) => {
    const x = M + i * cellW;
    if (i) vrule(x, y, metaH);
    text(row.label.toUpperCase(), x + 10, y - 16, label, bold, MUTED);
    cellLines[i].forEach((line, j) => text(line, x + 10, y - 30 - j * 11.5, 9.2, bold));
  });
  y -= metaH + 26;

  // --- From / Bill to -------------------------------------------------------------------------
  const colWidth = CW / 2 - 16;
  const party = (title: string, p: TemplateParty): Line[] => [
    { text: title.toUpperCase(), font: bold, size: label, color: MUTED, step: 0 },
    ...block(p.name, bold, 9.6, INK, colWidth, 15, 12),
    ...p.lines.flatMap((line) => block(line, regular, 9.2, INK, colWidth, 13, 12.5)),
    ...p.contacts.flatMap((line) => block(line, regular, 7.6, MUTED, colWidth, 11.5, 10.5)),
  ];
  const from = party("From", templateFrom(view));
  const to = party(isQuote ? "Prepared for" : "Bill to", templateBillTo(view));
  const partyH = Math.max(linesHeight(from), linesHeight(to)) + 12;
  ensure(partyH);
  drawLines(from, M, y - 8);
  drawLines(to, M + CW / 2, y - 8);
  y -= partyH + 20;

  // --- Red / black band: amount due beside the due date and project details -------------------
  const banner = templateBanner(view);
  const redW = CW * 0.4;
  const darkX = M + redW;
  const details = banner.details ? wrap(banner.details, regular, 7.4, CW - redW - 24) : [];
  const bannerH = Math.max(58, 44 + details.length * 10);
  let amountSize = 18;
  while (amountSize > 10 && bold.widthOfTextAtSize(pdfSafe(banner.amount), amountSize) > redW - 24) amountSize -= 0.5;
  ensure(bannerH);
  box(M, y, redW, bannerH, RED);
  box(darkX, y, CW - redW, bannerH, INK);
  text(banner.amountLabel.toUpperCase(), M + 12, y - 19, label, bold, WHITE);
  text(banner.amount, M + 12, y - 25 - amountSize * 0.85, amountSize, bold, WHITE);
  text(banner.dateLabel.toUpperCase(), darkX + 12, y - 15, label, bold, WHITE);
  text(banner.date, darkX + 12, y - 27, 9.2, bold, WHITE);
  details.forEach((line, i) => text(line, darkX + 12, y - 42 - i * 10, 7.4, regular, ON_DARK));
  y -= bannerH + 26;

  // --- Line items under a black header --------------------------------------------------------
  const cols = { desc: M + 9, qty: M + CW * 0.445, unit: M + CW * 0.54, amount: M + CW * 0.77 };
  const descWidth = cols.qty - cols.desc - 12;
  const headerH = 26;
  const tableHeader = () => {
    box(M, y, CW, headerH, INK);
    text("DESCRIPTION", cols.desc, y - 16.5, 7.4, bold, WHITE);
    text("QTY", cols.qty, y - 16.5, 7.4, bold, WHITE);
    text("UNIT PRICE", cols.unit, y - 16.5, 7.4, bold, WHITE);
    text("AMOUNT", cols.amount, y - 16.5, 7.4, bold, WHITE);
    y -= headerH;
  };
  ensure(24 + headerH + 32);
  text(`${docName} details`.toUpperCase(), M + 6, y - 10, 10, bold);
  y -= 24;
  tableHeader();
  view.items.forEach((item) => {
    const descLines = wrap(item.description, regular, body, descWidth);
    const rowHeight = Math.max(31.5, descLines.length * 12 + 19.5);
    if (ensure(rowHeight)) tableHeader();
    descLines.forEach((line, i) => text(line, cols.desc, y - 19 - i * 12, body));
    const qty = Number.isInteger(item.quantity) ? String(item.quantity) : String(Number(item.quantity.toFixed(2)));
    text(qty, cols.qty, y - 19, body);
    amount(money(item.unitPrice), cols.unit, y - 19, body);
    amount(money(item.amount), cols.amount, y - 19, body, bold);
    y -= rowHeight;
    rule(M, W - M, y);
  });
  y -= 12;

  // --- Totals: a light rule above Total, the final row on pink under a red rule ----------------
  const totals = templateTotalRows(view);
  const totalsX = M + CW * 0.478;
  const totalsRight = W - M - 6;
  const valueX = M + CW * 0.735;
  const rowH = 20;
  ensure(totals.length * rowH + 2);
  totals.forEach((row, index) => {
    const final = index === totals.length - 1;
    if (final) { box(totalsX, y, totalsRight - totalsX, rowH + 2, PINK); rule(totalsX, totalsRight, y, 1, RED); }
    else if (row.label === "Total") rule(totalsX, totalsRight, y);
    text(row.label, totalsX + 8, y - 13.5, body, final ? bold : regular, final ? INK : MUTED);
    amount(row.value, valueX, y - 13.5, body, bold);
    y -= final ? rowH + 2 : rowH;
  });
  y -= 24;

  // --- Grey panel: How to pay beside Payments received (invoices), or Next steps (quotes) -------
  const received = templatePaymentsReceived(view);
  const twoCols = !isQuote && received.length > 0;
  const panelColW = (twoCols ? CW / 2 : CW) - 24;
  const panelColumn = (title: string, rows: TemplateRow[], notes: string[] = []): Line[] => [
    { text: title.toUpperCase(), font: bold, size: 10, color: INK, step: 0 },
    ...rows.flatMap((row, r) => [
      ...(row.label ? block(row.label, bold, body, INK, panelColW, r ? 18 : 17, 12) : []),
      ...block(row.value, regular, body, SOFT, panelColW, row.label ? 12.5 : r ? 18 : 17, 12.5),
    ]),
    ...notes.flatMap((note) => block(note, regular, 7.6, MUTED, panelColW, 15, 10.5)),
  ];
  const columns: Line[][] = [];
  if (isQuote) {
    columns.push(panelColumn("Next steps", [view.decision
      ? { label: view.status === "ACCEPTED" ? "Accepted" : "Declined", value: `By ${view.decision.by} on ${view.decision.at}.${view.decision.note ? ` Note: ${view.decision.note}` : ""}` }
      : { label: "", value: `Accept this quotation online with the link you received, or reply to confirm. Please quote ${view.number} in any correspondence.` }]));
  } else {
    const payRows = templatePaymentRows(view);
    const rateNote = view.currency !== "KES" ? [`Payments in Kenya shillings are credited at KSh ${formatPlainAmount(view.exchangeRate)} per ${view.currency}.`] : [];
    columns.push(panelColumn("How to pay", payRows.length ? payRows : [{ label: "", value: "Payment details available on request." }], rateNote));
    if (twoCols) columns.push(panelColumn("Payments received", received));
  }
  const panelH = 19 + Math.max(...columns.map(linesHeight)) + 14;
  ensure(panelH);
  box(M, y, CW, panelH, PANEL, PANEL_RULE);
  if (twoCols) vrule(M + CW / 2, y, panelH);
  columns.forEach((lines, i) => drawLines(lines, M + 11 + i * (CW / 2), y - 19));
  y -= panelH + 22;

  // --- Closing terms in bold, then any special instructions ------------------------------------
  const closing = [
    ...block(view.terms.join(" "), bold, body, INK, CW - 6, 0, 12),
    ...(view.notes.trim() ? block(view.notes.trim(), regular, 8.2, SOFT, CW - 6, 15, 11.5) : []),
  ];
  for (const line of closing) {
    y -= line.step;
    if (y < FOOTER_SPACE) { newPage(); y -= 10; }
    text(line.text, M + 6, y, line.size, line.font, line.color);
  }

  // --- Page footers -------------------------------------------------------------------------
  const footer = templateFooter(view);
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, thickness: 1, color: RED });
    p.drawText(pdfSafe(footer.thanks), { x: M, y: 40, size: 7.4, font: bold, color: INK });
    const right = pdfSafe([footer.website, `Page ${index + 1} of ${pages.length}`].filter(Boolean).join(" · "));
    p.drawText(right, { x: W - M - regular.widthOfTextAtSize(right, 7.4), y: 40, size: 7.4, font: regular, color: MUTED });
  });

  return doc.save();
}
