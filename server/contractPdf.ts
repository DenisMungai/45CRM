import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildContractSections } from "./contracts";
import type { ContractFields } from "../shared/contract";

type Party = { name: string; email?: string | null; phone?: string | null };
type Signatures = {
  providerName?: string | null;
  providerSignedAt?: Date | string | null;
  clientName?: string | null;
  clientSignedAt?: Date | string | null;
  clientSignatureImageUrl?: string | null;
};

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function renderContractPdf(
  fields: ContractFields,
  provider: Party,
  client: Party,
  title: string,
  signatures?: Signatures,
): Promise<Uint8Array> {
  const { sections, title: heading } = buildContractSections(fields, provider, client, title);
  const doc = await PDFDocument.create();
  doc.setTitle(heading);
  doc.setProducer("45Creatives CRM");

  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawText(text: string, { size = 10, font = bodyFont, color = rgb(0.12, 0.12, 0.13), gap = 4 }: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) {
    const lineHeight = size * 1.35;
    for (const line of wrapLine(text, font, size, CONTENT_WIDTH)) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: MARGIN, y: y - lineHeight, size, font, color });
      y -= lineHeight;
    }
    y -= gap;
  }

  drawText(heading, { size: 16, font: boldFont, gap: 14 });

  for (const section of sections) {
    ensureSpace(24);
    drawText(section.heading, { size: 12, font: boldFont, gap: 6 });
    for (const line of section.body) drawText(line, { size: 10, gap: 6 });
    y -= 4;
  }

  ensureSpace(140);
  drawText("Signatures", { size: 12, font: boldFont, gap: 10 });

  async function drawSignatureBlock(label: string, signedName?: string | null, signedAt?: Date | null, signatureImageDataUrl?: string | null) {
    ensureSpace(95);
    drawText(label, { size: 10, font: boldFont, gap: 4 });
    const lineY = y - 46;
    let imageDrawn = false;
    if (signatureImageDataUrl?.startsWith("data:image/png;base64,")) {
      try {
        const png = await doc.embedPng(Buffer.from(signatureImageDataUrl.split(",")[1], "base64"));
        const targetHeight = 40;
        const scale = targetHeight / png.height;
        page.drawImage(png, { x: MARGIN + 2, y: lineY + 2, width: png.width * scale, height: targetHeight });
        imageDrawn = true;
      } catch { /* fall through to typed-name rendering below */ }
    }
    page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: MARGIN + 240, y: lineY }, thickness: 0.75, color: rgb(0.3, 0.3, 0.32) });
    if (signedName && !imageDrawn) {
      page.drawText(signedName, { x: MARGIN + 4, y: lineY + 4, size: 13, font: bodyFont, color: rgb(0.12, 0.12, 0.13) });
    }
    y = lineY - 4;
    drawText(signedName ? `Signed by ${signedName}${signedAt ? ` on ${new Date(signedAt).toLocaleString()}` : ""}` : "Name: ___________________________   Date: ______________", { size: 8.5, color: rgb(0.4, 0.4, 0.42), gap: 14 });
  }

  await drawSignatureBlock("Service Provider", signatures?.providerName, signatures?.providerSignedAt ? new Date(signatures.providerSignedAt) : null);
  await drawSignatureBlock("Client", signatures?.clientName, signatures?.clientSignedAt ? new Date(signatures.clientSignedAt) : null, signatures?.clientSignatureImageUrl);

  return doc.save();
}
