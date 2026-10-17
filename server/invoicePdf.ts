import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { INVOICE_TAGLINE, formatInvoiceMoney, type InvoiceView } from "../shared/invoice.js";

const W = 595.28; // A4 at 72dpi
const H = 841.89;
const M = 40;
const CW = W - M * 2;
const FOOTER_SPACE = 34;

const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.8, 0.07, 0.12);
const RULE = rgb(0.86, 0.86, 0.86);
const PANEL = rgb(0.965, 0.965, 0.965);
const BLACK = rgb(0.05, 0.05, 0.05);
const WHITE = rgb(1, 1, 1);

/** The built-in PDF fonts only cover WinAnsi; map anything else to a safe equivalent so a client
 * name with an unusual character can never make PDF generation throw. */
export function pdfSafe(input: string | null | undefined): string {
  const replaced = (input ?? "")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...").replace(/\r/g, "").replace(/\t/g, " ");
  return Array.from(replaced).map((char) => {
    const code = char.codePointAt(0)!;
    if (char === "\n" || code === 0x2022 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return char;
    const stripped = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return /^[\x20-\x7e]+$/.test(stripped) ? stripped : "?";
  }).join("");
}

type Line = { label?: string; text: string };

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

/** "Label: value" lines where only the label is bold and wrapped lines start under the label. */
function labelValue(label: string, value: string, bold: PDFFont, regular: PDFFont, size: number, maxWidth: number): Line[] {
  if (!value.trim()) return [];
  const labelText = `${pdfSafe(label)} `;
  const offset = bold.widthOfTextAtSize(labelText, size);
  const words = pdfSafe(value).split(/\s+/).filter(Boolean);
  const lines: Line[] = [];
  let current = "";
  let available = maxWidth - offset;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (regular.widthOfTextAtSize(candidate, size) > available && current) { lines.push({ text: current }); current = word; available = maxWidth; } else current = candidate;
  }
  lines.push({ text: current });
  lines[0].label = labelText;
  return lines;
}

export async function renderInvoicePdf(view: InvoiceView): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${pdfSafe(view.number)}`);
  doc.setProducer("45Creatives CRM");
  doc.setAuthor(pdfSafe(view.business.name));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const ensure = (height: number) => { if (y - height < M + FOOTER_SPACE) { newPage(); return true; } return false; };
  const text = (value: string, x: number, baseline: number, size: number, font: PDFFont = regular, color = INK, align: "left" | "right" = "left") => {
    const safe = pdfSafe(value);
    const left = align === "right" ? x - font.widthOfTextAtSize(safe, size) : x;
    page.drawText(safe, { x: left, y: baseline, size, font, color });
  };
  const rect = (x: number, top: number, width: number, height: number, fill?: ReturnType<typeof rgb>, border?: ReturnType<typeof rgb>) => {
    page.drawRectangle({ x, y: top - height, width, height, color: fill, borderColor: border, borderWidth: border ? 0.6 : 0 });
  };

  // --- Header -------------------------------------------------------------------------------
  const name = pdfSafe(view.business.name) || "45Creatives";
  const split = /^(\d+)(.*)$/.exec(name);
  const markSize = 26;
  if (split && split[2]) {
    text(split[1], M, y - markSize, markSize, bold, INK);
    text(split[2], M + bold.widthOfTextAtSize(split[1], markSize), y - markSize, markSize, bold, RED);
  } else text(name, M, y - markSize, markSize, bold, INK);
  let leftY = y - markSize - 14;
  text(INVOICE_TAGLINE, M, leftY, 7.5, bold, MUTED);
  const contactLines = [view.business.address, [view.business.email, view.business.phone].filter(Boolean).join(" \u00B7 "), view.business.website].filter(Boolean);
  for (const line of contactLines) { leftY -= 10.5; text(line, M, leftY, 7.5, regular, MUTED); }

  text("INVOICE", W - M, y - 30, 30, bold, INK, "right");
  let rightY = y - 30 - 14;
  const statusLabel = "STATUS: ";
  const statusWidth = bold.widthOfTextAtSize(pdfSafe(view.status), 8.5);
  text(pdfSafe(view.status), W - M, rightY, 8.5, bold, view.status === "PAID" ? INK : RED, "right");
  text(statusLabel.trim(), W - M - statusWidth - 4, rightY, 8.5, regular, INK, "right");
  for (const line of [`Invoice no. ${view.number}`, `Issue date ${view.issueDate}`, `Due date ${view.dueDate}`]) { rightY -= 11.5; text(line, W - M, rightY, 8.5, regular, INK, "right"); }

  y = Math.min(leftY, rightY) - 12;
  page.drawRectangle({ x: M, y: y - 2, width: CW, height: 2.2, color: RED });
  y -= 18;

  // --- Bill to / Project details ------------------------------------------------------------
  const colWidth = CW / 2;
  const pad = 9;
  const bodySize = 8.5;
  const lineHeight = 12;
  const billLines: Line[] = [
    ...labelValue("Client / Company:", view.billTo.client, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Contact person:", view.billTo.contact, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Email:", view.billTo.email, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Phone:", view.billTo.phone, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Billing address:", view.billTo.address, bold, regular, bodySize, colWidth - pad * 2),
  ];
  const projectLines: Line[] = [
    ...labelValue("Project:", view.project.name, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Scope:", view.project.scope, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Quotation / contract ref:", view.project.quotationRef, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Payment terms:", view.project.paymentTerms, bold, regular, bodySize, colWidth - pad * 2),
    ...labelValue("Project milestone:", view.project.milestone, bold, regular, bodySize, colWidth - pad * 2),
  ];
  const headHeight = 20;
  const bodyHeight = Math.max(billLines.length, projectLines.length, 1) * lineHeight + pad * 2 - 2;
  ensure(headHeight + bodyHeight + 30);
  rect(M, y, CW, headHeight + bodyHeight, undefined, RULE);
  rect(M, y, CW, headHeight, PANEL, RULE);
  text("BILL TO", M + pad, y - 13, 7.5, bold, INK);
  text("PROJECT DETAILS", M + colWidth + pad, y - 13, 7.5, bold, INK);
  const drawLines = (lines: Line[], x: number) => {
    let by = y - headHeight - pad - 8;
    for (const line of lines) {
      let lx = x;
      if (line.label) { text(line.label, lx, by, bodySize, bold); lx += bold.widthOfTextAtSize(line.label, bodySize); }
      text(line.text, lx, by, bodySize, regular);
      by -= lineHeight;
    }
  };
  drawLines(billLines, M + pad);
  drawLines(projectLines, M + colWidth + pad);
  y -= headHeight + bodyHeight + 20;

  // --- Itemized services --------------------------------------------------------------------
  const cols = { qty: W - M - 90 - 90 - 40, unit: W - M - 90 - 90, amount: W - M - 90 };
  const tableHeader = () => {
    rect(M, y, CW, 20, BLACK);
    text("DESCRIPTION", M + 8, y - 13, 7, bold, WHITE);
    text("QTY", cols.qty + 6, y - 13, 7, bold, WHITE);
    text("UNIT PRICE (KSh)", cols.unit + 8, y - 13, 7, bold, WHITE);
    text("AMOUNT (KSh)", cols.amount + 8, y - 13, 7, bold, WHITE);
    y -= 20;
  };
  ensure(20 + 40 + 24);
  text("ITEMIZED SERVICES", M, y - 8, 7.5, bold, INK);
  y -= 16;
  tableHeader();
  view.items.forEach((item, index) => {
    const descLines = wrap(item.description, regular, bodySize, cols.qty - M - 16);
    const rowHeight = Math.max(26, descLines.length * 11 + 14);
    if (ensure(rowHeight)) tableHeader();
    rect(M, y, CW, rowHeight, index % 2 === 0 ? PANEL : WHITE);
    page.drawLine({ start: { x: M, y: y - rowHeight }, end: { x: M + CW, y: y - rowHeight }, thickness: 0.4, color: RULE });
    descLines.forEach((line, i) => text(line, M + 8, y - 15 - i * 11, bodySize));
    const qty = Number.isInteger(item.quantity) ? String(item.quantity) : String(Number(item.quantity.toFixed(2)));
    text(qty, cols.qty + 6, y - 15, bodySize);
    text(formatInvoiceMoney(item.unitPrice).replace("KSh ", ""), cols.unit + 8, y - 15, bodySize);
    text(formatInvoiceMoney(item.amount).replace("KSh ", ""), cols.amount + 8, y - 15, bodySize);
    y -= rowHeight;
  });
  y -= 16;

  // --- Payment instructions + totals --------------------------------------------------------
  const leftW = 262;
  const rightX = M + leftW + 16;
  const rightW = CW - leftW - 16;
  const innerW = leftW - pad * 2;
  const instr: Line[] = [
    ...labelValue("M-Pesa:", [view.payment.mpesaNumber, view.payment.mpesaNumber ? `\u00B7 Account: ${view.payment.mpesaAccount}` : ""].filter(Boolean).join(" "), bold, regular, 8, innerW),
    ...labelValue("Bank:", [view.payment.bankName, view.payment.bankAccountName && `\u00B7 Account name: ${view.payment.bankAccountName}`, view.payment.bankAccountNumber && `\u00B7 Account no.: ${view.payment.bankAccountNumber}`].filter(Boolean).join(" "), bold, regular, 8, innerW),
  ];
  if (!instr.length) instr.push({ text: "Payment details available on request." });
  instr.push(...labelValue("Reference:", `Please quote ${view.number} when paying${view.payment.confirmationContact ? ` and send confirmation to ${view.payment.confirmationContact}` : ""}.`, bold, regular, 8, innerW));
  const record: Line[] = view.paymentRecord
    ? [
        ...labelValue("Payment date:", view.paymentRecord.date, bold, regular, 8, innerW),
        ...labelValue("Method:", view.paymentRecord.method, bold, regular, 8, innerW),
        ...labelValue("Transaction reference:", view.paymentRecord.reference, bold, regular, 8, innerW),
        ...labelValue("Amount received:", formatInvoiceMoney(view.paymentRecord.amount), bold, regular, 8, innerW),
        ...(view.paymentRecord.count > 1 ? [{ text: `${view.paymentRecord.count} payments recorded in total.` }] : []),
      ]
    : [{ text: "No payment recorded yet." }];
  const leftHeight = 14 + instr.length * 11 + 10 + 14 + record.length * 11 + 12;
  const totalsHeight = 4 * 24 + 36 + 12;
  const blockHeight = Math.max(leftHeight, totalsHeight);
  ensure(blockHeight);
  const blockTop = y;
  rect(M, blockTop, leftW, blockHeight, PANEL, RULE);
  let ly = blockTop - 16;
  text("PAYMENT INSTRUCTIONS", M + pad, ly, 7.5, bold);
  const drawSmall = (lines: Line[]) => {
    for (const line of lines) {
      ly -= 11;
      let lx = M + pad;
      if (line.label) { text(line.label, lx, ly, 8, bold); lx += bold.widthOfTextAtSize(line.label, 8); }
      text(line.text, lx, ly, 8);
    }
  };
  drawSmall(instr);
  ly -= 18;
  text("PAYMENT RECORD", M + pad, ly, 7.5, bold);
  drawSmall(record);

  let ry = blockTop;
  const totalRow = (label: string, value: string) => {
    text(label, rightX + 8, ry - 15, 8.5, regular);
    text(value, rightX + rightW - 8, ry - 15, 8.5, regular, INK, "right");
    page.drawLine({ start: { x: rightX, y: ry - 24 }, end: { x: rightX + rightW, y: ry - 24 }, thickness: 0.4, color: RULE });
    ry -= 24;
  };
  totalRow("Subtotal", formatInvoiceMoney(view.totals.subtotal));
  totalRow("Discount (if applicable)", formatInvoiceMoney(view.totals.discount));
  rect(rightX, ry, rightW, 28, PANEL);
  page.drawLine({ start: { x: rightX, y: ry }, end: { x: rightX + rightW, y: ry }, thickness: 1.2, color: RED });
  text("INVOICE TOTAL", rightX + 8, ry - 18, 9, bold);
  text(formatInvoiceMoney(view.totals.total), rightX + rightW - 8, ry - 19, 12, bold, RED, "right");
  ry -= 28;
  totalRow("Deposit / payments received", view.totals.received > 0 ? `(${formatInvoiceMoney(view.totals.received)})` : formatInvoiceMoney(0));
  rect(rightX, ry, rightW, 28, PANEL);
  text("BALANCE DUE", rightX + 8, ry - 18, 9, bold);
  text(formatInvoiceMoney(view.totals.balance), rightX + rightW - 8, ry - 19, 12, bold, RED, "right");
  y = blockTop - blockHeight - 18;

  // --- Terms & notes ------------------------------------------------------------------------
  const termItems = [...view.terms, ...(view.notes.trim() ? [`Notes / special instructions: ${view.notes.trim()}`] : [])];
  const termLines = termItems.map((term) => wrap(term, regular, 7.5, CW - pad * 2 - 10));
  const termsHeight = 16 + termLines.reduce((sum, lines) => sum + lines.length * 10 + 4, 0) + 8;
  ensure(termsHeight);
  rect(M, y, CW, termsHeight, PANEL, RULE);
  text("TERMS & NOTES", M + pad, y - 14, 7.5, bold);
  let ty = y - 14;
  for (const lines of termLines) {
    ty -= 4;
    lines.forEach((line, i) => { ty -= 10; if (i === 0) text("\u2022", M + pad, ty, 7.5, regular, MUTED); text(line, M + pad + 10, ty, 7.5, regular, MUTED); });
  }
  y -= termsHeight + 16;

  // --- Thank you ----------------------------------------------------------------------------
  const thanks = wrap(`Thank you for choosing ${name}. We appreciate your business.`, regular, 8.5, 230);
  ensure(thanks.length * 11 + 20);
  page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.5, color: RULE });
  thanks.forEach((line, i) => text(line, M, y - 16 - i * 11, 8.5, i === 0 ? bold : regular));
  text([view.business.website, view.business.email, view.business.phone].filter(Boolean).join(" \u00B7 "), W - M, y - 16, 7.5, regular, MUTED, "right");

  // --- Page footers -------------------------------------------------------------------------
  const pages = doc.getPages();
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: M, y: M + 12 }, end: { x: W - M, y: M + 12 }, thickness: 0.4, color: RULE });
    p.drawText(pdfSafe(`${name} | Web Development Services`), { x: M, y: M, size: 7, font: regular, color: MUTED });
    const label = `Page ${index + 1}${pages.length > 1 ? ` of ${pages.length}` : ""}`;
    p.drawText(label, { x: W - M - regular.widthOfTextAtSize(label, 7), y: M, size: 7, font: regular, color: MUTED });
  });

  return doc.save();
}
