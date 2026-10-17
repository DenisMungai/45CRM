import { and, desc, eq, like } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.js";
import { clients, invoiceDocuments, invoices, payments, workspaces } from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";
import { buildWhatsAppLink } from "./whatsappDelivery.js";
import {
  buildInvoiceView, computeInvoiceTotals, defaultInvoiceFields, deriveInvoiceStatus, formatInvoiceMoney, INVOICE_NUMBER_PREFIX, nextInvoiceNumberFrom, nextStoredInvoiceStatus, paymentInstructionKeys,
  type InvoiceDisplayStatus, type InvoiceFields, type InvoiceView,
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

export type InvoiceSummary = {
  id: string; number: string; clientName: string; issueDate: Date; dueDate: Date | null;
  total: number; received: number; balance: number; status: InvoiceDisplayStatus;
  hasDocument: boolean; sentAt: Date | null; lastSentChannel: string | null;
};

/** One row per invoice for the Invoices page, with the same totals and status as the invoice itself. */
export async function listInvoiceSummaries(workspaceId: string): Promise<InvoiceSummary[]> {
  const db = getDb();
  const [invoiceRows, documentRows, paymentRows, clientRows] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.workspaceId, workspaceId)).orderBy(desc(invoices.issueDate), desc(invoices.createdAt)),
    db.select().from(invoiceDocuments).where(eq(invoiceDocuments.workspaceId, workspaceId)),
    db.select({ invoiceId: payments.invoiceId, amount: payments.amount }).from(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.status, "completed"))),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.workspaceId, workspaceId)),
  ]);
  const documents = new Map(documentRows.map((d) => [d.invoiceId, d]));
  const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));
  const paidByInvoice = new Map<string, number>();
  for (const p of paymentRows) if (p.invoiceId) paidByInvoice.set(p.invoiceId, (paidByInvoice.get(p.invoiceId) || 0) + (Number(p.amount) || 0));
  return invoiceRows.map((invoice) => {
    const document = documents.get(invoice.id);
    const fields = document ? withDefaults(document.fields as Partial<InvoiceFields>) : null;
    const payable = fields ? computeInvoiceTotals(fields.items, fields.discount).total : invoice.total;
    const paid = paidByInvoice.get(invoice.id) || 0;
    // Same rule as the invoice sheet: one marked Paid by hand counts as fully settled.
    const received = invoice.status === "paid" ? Math.max(paid, payable) : paid;
    return {
      id: invoice.id, number: invoice.number,
      clientName: fields?.clientName || (invoice.clientId ? clientNames.get(invoice.clientId) || "" : ""),
      issueDate: invoice.issueDate, dueDate: invoice.dueDate,
      total: payable, received, balance: Math.max(0, payable - received),
      status: deriveInvoiceStatus({ storedStatus: invoice.status, total: payable, received, dueDate: invoice.dueDate, sent: Boolean(document?.sentAt) }),
      hasDocument: Boolean(document), sentAt: document?.sentAt ?? null, lastSentChannel: document?.lastSentChannel ?? null,
    };
  });
}

export async function updateInvoiceDates(workspaceId: string, invoiceId: string, dates: { issueDate: Date; dueDate: Date }) {
  await getDb().update(invoices).set({ ...dates, updatedAt: new Date() }).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
}

/** Like withdrawing an agreement: the invoice stays on record as VOID and can no longer be sent. */
export async function voidInvoice(workspaceId: string, invoiceId: string) {
  await getDb().update(invoices).set({ status: "void", updatedAt: new Date() }).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
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

export async function nextInvoiceNumber(workspaceId: string) {
  const used = await getDb().select({ number: invoices.number }).from(invoices).where(and(eq(invoices.workspaceId, workspaceId), like(invoices.number, `${INVOICE_NUMBER_PREFIX}%`)));
  return nextInvoiceNumberFrom(used.map((r) => r.number));
}

function isUniqueViolation(error: unknown) {
  const code = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined);
  return code(error) === "23505" || code((error as { cause?: unknown } | null)?.cause) === "23505";
}

/**
 * Creates an invoice and its template details together, numbered by the server
 * (45C-INV-0001, 0002, ...). Two people creating invoices at once can race for the same number;
 * the unique index rejects the loser, which then takes the next one.
 */
export async function createInvoiceWithDocument(workspaceId: string, userId: string, input: { fields: InvoiceFields; issueDate: Date; dueDate: Date }) {
  const total = computeInvoiceTotals(input.fields.items, input.fields.discount).total;
  for (let attempt = 0; ; attempt++) {
    const number = await nextInvoiceNumber(workspaceId);
    try {
      return await getDb().transaction(async (tx) => {
        const client = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, input.fields.clientName))).limit(1).then((r) => r[0]);
        const invoice = await tx.insert(invoices).values({ workspaceId, clientId: client?.id ?? null, number, status: "draft", subtotal: total, total, issueDate: input.issueDate, dueDate: input.dueDate }).returning().then((r) => r[0]);
        await tx.insert(invoiceDocuments).values({ workspaceId, invoiceId: invoice.id, fields: input.fields, createdByUserId: userId });
        return invoice;
      });
    } catch (error) {
      if (attempt < 4 && isUniqueViolation(error)) continue;
      throw error;
    }
  }
}

export async function saveInvoiceDocument(workspaceId: string, userId: string, invoiceId: string, fields: InvoiceFields) {
  return getDb().insert(invoiceDocuments).values({ workspaceId, invoiceId, fields, createdByUserId: userId })
    .onConflictDoUpdate({ target: invoiceDocuments.invoiceId, set: { fields, updatedAt: new Date() }, where: eq(invoiceDocuments.workspaceId, workspaceId) })
    .returning().then((r) => r[0]);
}

export async function markInvoiceDocumentSent(id: string, channel: "email" | "whatsapp") {
  return getDb().update(invoiceDocuments).set({ sentAt: new Date(), lastSentChannel: channel, updatedAt: new Date() }).where(eq(invoiceDocuments.id, id)).returning().then((r) => r[0]);
}

/**
 * Writes the invoice template's total, the completed payments and the resulting status back onto
 * the `invoices` row, which is what the Invoices list, dashboard and reports read. Call it after
 * anything that changes the details, the send state or the payments of an invoice.
 */
export async function refreshInvoiceSummary(workspaceId: string, invoiceId: string) {
  const [invoice, document, paid] = await Promise.all([
    getInvoice(workspaceId, invoiceId),
    getInvoiceDocument(workspaceId, invoiceId),
    getDb().select({ amount: payments.amount }).from(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.invoiceId, invoiceId), eq(payments.status, "completed"))),
  ]);
  if (!invoice) return;
  const fields = document ? withDefaults(document.fields as Partial<InvoiceFields>) : null;
  const total = fields ? computeInvoiceTotals(fields.items, fields.discount).total : invoice.total;
  const received = paid.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const status = nextStoredInvoiceStatus({ storedStatus: invoice.status, total, received, sent: Boolean(document?.sentAt) }) as InvoiceRow["status"];
  if (total === invoice.total && received === invoice.amountPaid && status === invoice.status) return;
  await getDb().update(invoices).set({ total, subtotal: total, amountPaid: received, status, updatedAt: new Date() }).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
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

