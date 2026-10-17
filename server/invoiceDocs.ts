import { and, desc, eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.js";
import { clients, invoiceDocuments, invoices, payments, workspaces } from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";
import { buildWhatsAppLink } from "./whatsappDelivery.js";
import {
  buildInvoiceView, defaultInvoiceFields, formatInvoiceMoney, paymentInstructionKeys,
  type InvoiceFields, type InvoiceView,
} from "../shared/invoice.js";

type InvoiceRow = typeof invoices.$inferSelect;
type DocumentRow = typeof invoiceDocuments.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;

export async function getInvoice(workspaceId: string, invoiceId: string) {
  return getDb().select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId))).limit(1).then((r) => r[0]);
}

export async function listInvoiceDocuments(workspaceId: string) {
  return getDb().select({ invoiceId: invoiceDocuments.invoiceId, sentAt: invoiceDocuments.sentAt, lastSentChannel: invoiceDocuments.lastSentChannel }).from(invoiceDocuments).where(eq(invoiceDocuments.workspaceId, workspaceId));
}

export async function getInvoiceDocument(workspaceId: string, invoiceId: string) {
  return getDb().select().from(invoiceDocuments).where(and(eq(invoiceDocuments.workspaceId, workspaceId), eq(invoiceDocuments.invoiceId, invoiceId))).limit(1).then((r) => r[0]);
}

/** Payment instructions rarely change, so a new invoice starts from the most recent one. */
export async function latestPaymentInstructions(workspaceId: string): Promise<Partial<InvoiceFields>> {
  const latest = await getDb().select().from(invoiceDocuments).where(eq(invoiceDocuments.workspaceId, workspaceId)).orderBy(desc(invoiceDocuments.updatedAt)).limit(1).then((r) => r[0]);
  if (!latest) return {};
  const fields = latest.fields as Partial<InvoiceFields>;
  const picked: Record<string, string> = {};
  for (const key of paymentInstructionKeys) if (typeof fields[key] === "string" && fields[key]) picked[key] = fields[key] as string;
  return picked as Partial<InvoiceFields>;
}

async function defaultFields(workspaceId: string, invoice: InvoiceRow, clientName?: string): Promise<InvoiceFields> {
  const name = clientName?.trim() || "";
  const client = name
    ? await getDb().select().from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, name))).limit(1).then((r) => r[0])
    : undefined;
  return {
    ...defaultInvoiceFields,
    ...(await latestPaymentInstructions(workspaceId)),
    clientName: name,
    clientEmail: client?.email || "",
    clientPhone: client?.phone || "",
    items: [{ description: "Web development services", quantity: 1, unitPrice: invoice.total }],
  };
}

/** Normalises stored fields so older rows (or hand-edited JSON) can never break rendering. */
function withDefaults(fields: Partial<InvoiceFields> | null | undefined): InvoiceFields {
  const merged = { ...defaultInvoiceFields, ...(fields || {}) } as InvoiceFields;
  if (!Array.isArray(merged.items) || !merged.items.length) merged.items = defaultInvoiceFields.items;
  return merged;
}

export type InvoiceBundle = {
  invoice: InvoiceRow;
  document: DocumentRow | undefined;
  fields: InvoiceFields;
  view: InvoiceView;
  workspace: WorkspaceRow;
};

async function assemble(workspace: WorkspaceRow, invoice: InvoiceRow, document: DocumentRow | undefined, clientNameHint?: string): Promise<InvoiceBundle> {
  const fields = document ? withDefaults(document.fields as Partial<InvoiceFields>) : await defaultFields(workspace.id, invoice, clientNameHint);
  const paid = await getDb().select().from(payments).where(and(eq(payments.workspaceId, workspace.id), eq(payments.invoiceId, invoice.id), eq(payments.status, "completed")));
  const view = buildInvoiceView({
    number: invoice.number,
    storedStatus: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    sent: Boolean(document?.sentAt),
    business: { name: workspace.name, address: workspace.businessAddress || "", email: workspace.businessEmail || "", phone: workspace.businessPhone || "" },
    fields,
    payments: paid.map((p) => ({ paidAt: p.paidAt, method: p.method, number: p.number, amount: p.amount })),
  });
  return { invoice, document, fields, view, workspace };
}

export async function loadInvoiceBundle(workspaceId: string, invoiceId: string, clientNameHint?: string): Promise<InvoiceBundle | undefined> {
  const [invoice, document, workspace] = await Promise.all([
    getInvoice(workspaceId, invoiceId),
    getInvoiceDocument(workspaceId, invoiceId),
    getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0]),
  ]);
  if (!invoice || !workspace) return undefined;
  return assemble(workspace, invoice, document, clientNameHint);
}

export async function saveInvoiceDocument(workspaceId: string, userId: string, invoiceId: string, fields: InvoiceFields) {
  return getDb().insert(invoiceDocuments).values({ workspaceId, invoiceId, fields, createdByUserId: userId })
    .onConflictDoUpdate({ target: invoiceDocuments.invoiceId, set: { fields, updatedAt: new Date() }, where: eq(invoiceDocuments.workspaceId, workspaceId) })
    .returning().then((r) => r[0]);
}

export async function markInvoiceDocumentSent(id: string, channel: "email" | "whatsapp") {
  return getDb().update(invoiceDocuments).set({ sentAt: new Date(), lastSentChannel: channel, updatedAt: new Date() }).where(eq(invoiceDocuments.id, id)).returning().then((r) => r[0]);
}

// --- Share links -------------------------------------------------------------------------------
// The link is `<documentId>.<signature>`. The signature is an HMAC of the document id and its
// shareVersion, so the same link can be sent by email *and* WhatsApp (sending twice never breaks
// the first link), nothing secret is stored in plain text, and bumping shareVersion revokes it.

function signature(documentId: string, shareVersion: number) {
  return createHmac("sha256", ENV.sessionSecret).update(`invoice-link:${documentId}:${shareVersion}`).digest("base64url");
}

export function createInvoiceToken(document: Pick<DocumentRow, "id" | "shareVersion">) {
  return `${document.id}.${signature(document.id, document.shareVersion)}`;
}

export function invoiceViewUrl(document: Pick<DocumentRow, "id" | "shareVersion">) {
  return `${ENV.appUrl.replace(/\/$/, "")}/invoices/view/${createInvoiceToken(document)}`;
}

export async function loadInvoiceBundleByToken(token: string): Promise<InvoiceBundle | undefined> {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const document = await getDb().select().from(invoiceDocuments).where(eq(invoiceDocuments.id, id)).limit(1).then((r) => r[0]);
  if (!document) return undefined;
  const expected = Buffer.from(signature(document.id, document.shareVersion));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  const [invoice, workspace] = await Promise.all([
    getDb().select().from(invoices).where(eq(invoices.id, document.invoiceId)).limit(1).then((r) => r[0]),
    getDb().select().from(workspaces).where(eq(workspaces.id, document.workspaceId)).limit(1).then((r) => r[0]),
  ]);
  if (!invoice || !workspace) return undefined;
  return assemble(workspace, invoice, document);
}

// --- Outgoing messages -------------------------------------------------------------------------

function summaryLines(view: InvoiceView) {
  return [
    view.project.name ? `Project: ${view.project.name}` : null,
    `Amount due: ${formatInvoiceMoney(view.totals.balance)}`,
    `Due date: ${view.dueDate}`,
  ].filter((line): line is string => Boolean(line));
}

export function buildInvoiceWhatsAppMessage(view: InvoiceView, viewUrl: string) {
  const sender = view.business.name || "45Creatives";
  return [
    `Hello ${view.billTo.contact || view.billTo.client},`,
    "",
    `Invoice ${view.number} from ${sender} is ready.`,
    ...summaryLines(view),
    "",
    "View and download your invoice here:",
    viewUrl,
    "",
    `Please quote ${view.number} when paying${view.payment.confirmationContact ? ` and send confirmation to ${view.payment.confirmationContact}` : ""}.`,
    "",
    sender,
  ].join("\n");
}

export function buildInvoiceEmail(view: InvoiceView, viewUrl: string) {
  const sender = view.business.name || "45Creatives";
  const body = [
    `Hi ${view.billTo.contact || view.billTo.client},`,
    "",
    `Please find invoice ${view.number} from ${sender}.`,
    ...summaryLines(view),
    "",
    "View and download the invoice (PDF) here:",
    viewUrl,
    "",
    `Please quote ${view.number} when paying${view.payment.confirmationContact ? ` and send confirmation to ${view.payment.confirmationContact}` : ""}.`,
    "",
    "Thank you for choosing " + sender + ".",
    "",
    "Regards,",
    sender,
  ].join("\n");
  return { subject: `Invoice ${view.number} from ${sender}`, body };
}

export function buildInvoiceDrafts(view: InvoiceView, clientEmail: string, clientPhone: string, viewUrl: string) {
  const email = buildInvoiceEmail(view, viewUrl);
  const whatsappMessage = buildInvoiceWhatsAppMessage(view, viewUrl);
  return {
    waLink: clientPhone ? buildWhatsAppLink(clientPhone, whatsappMessage) : null,
    emailDraftUrl: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}&su=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`,
  };
}

export function invoicePdfFilename(view: Pick<InvoiceView, "number">) {
  return `${view.number.replace(/[^a-z0-9-_ ]/gi, "").trim().slice(0, 80) || "invoice"}.pdf`;
}

