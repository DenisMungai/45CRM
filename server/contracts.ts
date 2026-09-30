import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { contracts } from "../drizzle/schema.js";
import { defaultContractFields, type ContractFields } from "../shared/contract.js";

export { defaultContractFields, type ContractFields } from "../shared/contract.js";

const money = (n: number) => `KES ${Math.max(0, Math.round(n || 0)).toLocaleString("en-KE")}`;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const blank = (value: string | undefined) => (value && value.trim() ? value.trim() : "___________________");

type Party = { name: string; email?: string | null; phone?: string | null };

export function buildContractSections(fields: ContractFields, provider: Party, client: Party, title: string) {
  const deposit = Math.round((fields.totalCost || 0) * (fields.depositPercent || 0) / 100);
  const balance = Math.max(0, (fields.totalCost || 0) - deposit);
  const sections: { heading: string; body: string[] }[] = [
    { heading: "Parties", body: [
      `Service Provider: ${blank(provider.name)}${provider.email ? ` (${provider.email})` : ""}${provider.phone ? ` · ${provider.phone}` : ""}`,
      `Client: ${blank(client.name)}${client.email ? ` (${client.email})` : ""}${client.phone ? ` · ${client.phone}` : ""}`,
      `Date: ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`,
    ] },
    { heading: "1. Scope of Work", body: [
      `The Service Provider agrees to design and develop a website for the Client as described below.`,
      `Project Name: ${blank(fields.projectName)}`,
      `Website Type: ${blank(fields.websiteType)}`,
      `Pages Included: ${blank(fields.pages)}`,
      `Features Included: ${blank(fields.features)}`,
      `Any work not listed above is not included in this agreement. Additional features or pages requested after signing will be quoted separately.`,
    ] },
    { heading: "2. Price and Payment", body: [
      `Total Project Cost: ${money(fields.totalCost)}`,
      `Deposit (${fields.depositPercent || 0}%): ${money(deposit)} due before work begins`,
      `Balance: ${money(balance)} due before the website goes live`,
      `Payment Method: ${blank(fields.paymentMethod)}`,
      `The website will not be deployed or handed over until the full balance is paid.`,
    ] },
    { heading: "3. Timeline", body: [
      `Estimated Start Date: ${blank(fields.startDate)}, upon receipt of deposit`,
      `Estimated Delivery: approximately ${blank(fields.deliveryWeeks)} week(s) from start`,
      `Delays caused by the Client, including late content, slow feedback, or unavailability, will extend the delivery date accordingly. The Service Provider will communicate any delays from their side promptly.`,
    ] },
    { heading: "4. Revisions", body: [
      `This agreement includes ${fields.revisionRounds ?? 2} round(s) of revisions after the initial design is presented.`,
      `A revision is a change to existing work within the agreed scope. A new feature, a new page, or a change to the agreed scope is not a revision. It is additional work and will be quoted separately.`,
      `Additional revisions beyond the included rounds will be charged at ${money(fields.extraRevisionCost)} per round.`,
    ] },
    { heading: "5. Content", body: [
      `The Client is responsible for providing the following before work begins: company name and logo (if available), text content for each page (or approval for the Service Provider to write it), photos and images, contact details, social media links, and any other information to appear on the site.`,
      `Content must be provided by ${blank(fields.contentDueDate)}. Delays in content delivery will extend the project timeline.`,
    ] },
    { heading: "6. Ownership and Handover", body: [
      `Upon receipt of full payment, the Client owns the completed website and all associated assets.`,
      `The Service Provider will hand over all login credentials, hosting access, domain access, database access, and source code where applicable.`,
      `Until full payment is received, all work remains the property of the Service Provider.`,
    ] },
    { heading: "7. Hosting and Domain", body: [
      `Domain Registration: ${fields.domainIncluded ? `Included (${blank(fields.domainName)})` : "Not included"}. Registered under the Client's name.`,
      `Hosting: ${fields.hostingIncluded ? `Included (${blank(fields.hostingPlatform)})` : "Not included"}. Annual hosting cost: ${money(fields.hostingCost)}, payable by the Client.`,
      `The Client is responsible for renewing the domain and hosting annually after handover.`,
    ] },
    { heading: "8. What Is Not Included", body: [
      `Unless separately agreed and paid for, the following are not part of this project: ongoing website maintenance and updates, SEO services beyond basic on-page setup, social media management, paid advertising or ad management, content writing (unless specified in scope above), photography or videography. These can be offered as separate paid services.`,
    ] },
    { heading: "9. Maintenance (Optional)", body: [
      `After delivery, the Client may opt into a monthly maintenance plan covering small updates, fixes, backups, and support.`,
      `Monthly Maintenance Fee: ${money(fields.maintenanceFee)} per month. This is optional and billed separately.`,
    ] },
    { heading: "10. Termination", body: [
      `Either party may terminate this agreement with written notice.`,
      `If the Client cancels after work has begun, the deposit is non-refundable. Work completed up to the point of cancellation will be invoiced and is payable.`,
      `If the Service Provider cancels, any deposit received will be refunded in full within 7 days.`,
    ] },
    { heading: "11. Confidentiality", body: [
      `Both parties agree to keep all project information, business details, and login credentials confidential and not share them with third parties without written consent.`,
    ] },
    { heading: "12. Portfolio Rights", body: [
      `The Service Provider reserves the right to display the completed website in their portfolio and marketing materials unless the Client objects in writing before project completion.`,
    ] },
  ];
  if (fields.notes?.trim()) sections.push({ heading: "13. Additional Notes", body: [fields.notes.trim()] });
  return { sections, title: title || `Web Design & Development Agreement - ${fields.projectName || "Untitled project"}` };
}

export function renderContractText(fields: ContractFields, provider: Party, client: Party, title: string) {
  const { sections, title: heading } = buildContractSections(fields, provider, client, title);
  return [heading.toUpperCase(), "", ...sections.flatMap((s) => [s.heading, ...s.body, ""])].join("\n").trim();
}

export function renderContractHtml(fields: ContractFields, provider: Party, client: Party, title: string, signatures?: { providerName?: string | null; providerSignedAt?: Date | null; clientName?: string | null; clientSignedAt?: Date | null; clientSignatureImageUrl?: string | null }) {
  const { sections, title: heading } = buildContractSections(fields, provider, client, title);
  const body = sections.map((s) => `<section><h2>${esc(s.heading)}</h2>${s.body.map((line) => `<p>${esc(line)}</p>`).join("")}</section>`).join("");
  const partyBlock = (label: string, signedName?: string | null, signedAt?: Date | null, signatureImageUrl?: string | null) => signedName
    ? `<div class="sig-row sig-signed"><strong>${esc(label)}</strong>${signatureImageUrl ? `<img src="${signatureImageUrl}" alt="${esc(label)} signature" class="sig-image" />` : `<span class="sig-name">${esc(signedName)}</span>`}<span class="sig-meta">Signed by ${esc(signedName)}${signedAt ? ` on ${new Date(signedAt).toLocaleString()}` : ""}</span></div>`
    : `<div class="sig-row sig-pending"><strong>${esc(label)}</strong><span class="sig-line" aria-hidden="true"></span><span class="sig-meta">Name: ___________________________&nbsp;&nbsp;&nbsp;Date: ______________</span></div>`;
  const signBlock = `<section class="signatures"><h2>Signatures</h2>
    ${partyBlock("Service Provider", signatures?.providerName, signatures?.providerSignedAt)}
    ${partyBlock("Client", signatures?.clientName, signatures?.clientSignedAt, signatures?.clientSignatureImageUrl)}
  </section>`;
  return `<article class="contract-document"><h1>${esc(heading)}</h1>${body}${signBlock}</article>`;
}

export async function createContract(workspaceId: string, userId: string, input: { clientId?: string | null; projectId?: string | null; title: string; providerName: string; providerEmail?: string | null; providerPhone?: string | null; clientName: string; clientEmail?: string | null; clientPhone?: string | null; fields: ContractFields }) {
  const documentText = renderContractText(input.fields, { name: input.providerName, email: input.providerEmail, phone: input.providerPhone }, { name: input.clientName, email: input.clientEmail, phone: input.clientPhone }, input.title);
  const documentHtml = renderContractHtml(input.fields, { name: input.providerName, email: input.providerEmail, phone: input.providerPhone }, { name: input.clientName, email: input.clientEmail, phone: input.clientPhone }, input.title, { providerName: null, providerSignedAt: null, clientName: null, clientSignedAt: null, clientSignatureImageUrl: null });
  return getDb().insert(contracts).values({
    workspaceId,
    clientId: input.clientId || null,
    projectId: input.projectId || null,
    title: input.title,
    providerName: input.providerName,
    providerEmail: input.providerEmail,
    providerPhone: input.providerPhone,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
    fields: input.fields,
    documentText,
    documentHtml,
    createdByUserId: userId,
  }).returning().then((r) => r[0]);
}

export async function updateContract(workspaceId: string, id: string, input: { clientId?: string | null; projectId?: string | null; title: string; providerName: string; providerEmail?: string | null; providerPhone?: string | null; clientName: string; clientEmail?: string | null; clientPhone?: string | null; fields: ContractFields }) {
  const existing = await getContract(workspaceId, id);
  const documentText = renderContractText(input.fields, { name: input.providerName, email: input.providerEmail, phone: input.providerPhone }, { name: input.clientName, email: input.clientEmail, phone: input.clientPhone }, input.title);
  const documentHtml = renderContractHtml(input.fields, { name: input.providerName, email: input.providerEmail, phone: input.providerPhone }, { name: input.clientName, email: input.clientEmail, phone: input.clientPhone }, input.title, {
    providerName: existing?.providerSignatureName ?? null,
    providerSignedAt: existing?.providerSignedAt ?? null,
    clientName: existing?.clientSignatureName ?? null,
    clientSignedAt: existing?.clientSignedAt ?? null,
    clientSignatureImageUrl: existing?.clientSignatureImageUrl ?? null,
  });
  return getDb().update(contracts).set({
    clientId: input.clientId || null,
    projectId: input.projectId || null,
    title: input.title,
    providerName: input.providerName,
    providerEmail: input.providerEmail,
    providerPhone: input.providerPhone,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    clientPhone: input.clientPhone,
    fields: input.fields,
    documentText,
    documentHtml,
    // Editing invalidates any outstanding signing link and returns the contract to draft
    // so the client can never sign terms that differ from what they were shown.
    status: "draft",
    tokenHash: null,
    sentAt: null,
    expiresAt: null,
    providerSignatureName: null,
    providerSignedAt: null,
    whatsappMessageId: null,
    whatsappDeliveryStatus: null,
    whatsappSentAt: null,
    whatsappDeliveredAt: null,
    whatsappReadAt: null,
    updatedAt: new Date(),
  }).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function listContracts(workspaceId: string) {
  return getDb().select().from(contracts).where(eq(contracts.workspaceId, workspaceId)).orderBy(desc(contracts.createdAt));
}

export async function getContract(workspaceId: string, id: string) {
  return getDb().select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).limit(1).then((r) => r[0]);
}

export async function voidContract(workspaceId: string, id: string) {
  return getDb().update(contracts).set({ status: "voided", updatedAt: new Date() }).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function deleteContract(workspaceId: string, id: string) {
  return getDb().delete(contracts).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function signContractAsProvider(workspaceId: string, id: string, signatureName: string) {
  return getDb().update(contracts).set({ providerSignatureName: signatureName, providerSignedAt: new Date(), updatedAt: new Date() }).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function markContractSent(
  workspaceId: string,
  id: string,
  tokenHash: string,
  whatsapp?: { messageId?: string | null; status?: string | null }
) {
  return getDb().update(contracts).set({
    status: "sent",
    tokenHash,
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 86400000),
    ...(whatsapp?.messageId ? { whatsappMessageId: whatsapp.messageId } : {}),
    ...(whatsapp?.status ? { whatsappDeliveryStatus: whatsapp.status, whatsappSentAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function setContractWhatsAppStatus(
  contractId: string,
  whatsappMessageId: string,
  status: string
) {
  return getDb().update(contracts).set({
    whatsappMessageId,
    whatsappDeliveryStatus: status,
    whatsappSentAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(contracts.id, contractId)).returning().then((r) => r[0]);
}

export async function findContractByTokenHash(tokenHash: string) {
  return getDb().select().from(contracts).where(eq(contracts.tokenHash, tokenHash)).limit(1).then((r) => r[0]);
}

export async function signContractAsClient(id: string, input: { signatureName: string; signatureImageUrl: string | null; ip: string | null }) {
  const documentHtmlRow = await getDb().select().from(contracts).where(eq(contracts.id, id)).limit(1).then((r) => r[0]);
  if (!documentHtmlRow) return undefined;
  const signedAt = new Date();
  const fields = documentHtmlRow.fields as ContractFields;
  const documentHtml = renderContractHtml(fields, { name: documentHtmlRow.providerName, email: documentHtmlRow.providerEmail, phone: documentHtmlRow.providerPhone }, { name: documentHtmlRow.clientName, email: documentHtmlRow.clientEmail, phone: documentHtmlRow.clientPhone }, documentHtmlRow.title, {
    providerName: documentHtmlRow.providerSignatureName,
    providerSignedAt: documentHtmlRow.providerSignedAt,
    clientName: input.signatureName,
    clientSignedAt: signedAt,
    clientSignatureImageUrl: input.signatureImageUrl,
  });
  return getDb().update(contracts).set({
    status: "signed",
    clientSignatureName: input.signatureName,
    clientSignatureImageUrl: input.signatureImageUrl,
    clientSignedAt: signedAt,
    clientSignatureIp: input.ip,
    documentHtml,
    updatedAt: signedAt,
  }).where(eq(contracts.id, id)).returning().then((r) => r[0]);
}

export function newSigningToken() {
  return randomUUID() + randomUUID();
}

// --- Documenso audit-trail layer -------------------------------------------------------------
// These track a Documenso envelope created *alongside* the signing flow above. Our own draft →
// sign → send → sign-as-client flow above remains the primary UX; Documenso here exists purely
// to have both parties additionally sign through Documenso itself, producing an independently
// certified PDF and audit trail for legal purposes.

export async function saveDocumensoEnvelope(workspaceId: string, id: string, data: { envelopeId: string; providerSigningUrl: string | null; clientSigningUrl: string | null }) {
  return getDb().update(contracts).set({
    documensoEnvelopeId: data.envelopeId,
    documensoStatus: "pending",
    documensoProviderSigningUrl: data.providerSigningUrl,
    documensoClientSigningUrl: data.clientSigningUrl,
    documensoCompletedAt: null,
    updatedAt: new Date(),
  }).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, id))).returning().then((r) => r[0]);
}

export async function findContractByDocumensoEnvelopeId(envelopeId: string) {
  return getDb().select().from(contracts).where(eq(contracts.documensoEnvelopeId, envelopeId)).limit(1).then((r) => r[0]);
}

export async function setDocumensoStatus(id: string, status: "pending" | "completed" | "rejected" | "cancelled", certifiedPdfPath?: string | null) {
  return getDb().update(contracts).set({
    documensoStatus: status,
    ...(certifiedPdfPath !== undefined ? { documensoCertifiedPdfPath: certifiedPdfPath } : {}),
    ...(status === "completed" ? { documensoCompletedAt: new Date() } : {}),
    updatedAt: new Date(),
  }).where(eq(contracts.id, id)).returning().then((r) => r[0]);
}
