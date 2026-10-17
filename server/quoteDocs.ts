import { and, eq, like } from "drizzle-orm";
import { getDb } from "./db.js";
import { clients, quoteDocuments, quotes, workspaces } from "../drizzle/schema.js";
import { latestPaymentInstructions } from "./invoiceDocs.js";
import { buildWhatsAppLink } from "./whatsappDelivery.js";
import { createShareToken, publicUrl, shareTokenId, verifyShareToken } from "./shareLinks.js";
import { buildInvoiceView, computeInvoiceTotals, defaultInvoiceFields, formatInvoiceMoney, rateOf, type InvoiceFields, type InvoiceView } from "../shared/invoice.js";

type QuoteRow = typeof quotes.$inferSelect;
type QuoteDocRow = typeof quoteDocuments.$inferSelect;
type WorkspaceRow = typeof workspaces.$inferSelect;
export type QuoteBundle = { quote: QuoteRow; document: QuoteDocRow | undefined; fields: InvoiceFields; view: InvoiceView; workspace: WorkspaceRow };

const LINK_KIND = "quote-link";

export async function getQuote(workspaceId: string, quoteId: string) {
  return getDb().select().from(quotes).where(and(eq(quotes.workspaceId, workspaceId), eq(quotes.id, quoteId))).limit(1).then((r) => r[0]);
}
async function getQuoteDocument(quoteId: string) {
  return getDb().select().from(quoteDocuments).where(eq(quoteDocuments.quoteId, quoteId)).limit(1).then((r) => r[0]);
}
function withDefaults(fields: Partial<InvoiceFields> | null | undefined): InvoiceFields {
  const merged = { ...defaultInvoiceFields, ...(fields || {}) } as InvoiceFields;
  if (!Array.isArray(merged.items) || !merged.items.length) merged.items = defaultInvoiceFields.items;
  return merged;
}

/** A quote without saved details starts from its table row: client, project and value as one line. */
async function defaultFields(workspaceId: string, quote: QuoteRow): Promise<InvoiceFields> {
  const client = quote.clientId ? await getDb().select().from(clients).where(eq(clients.id, quote.clientId)).limit(1).then((r) => r[0]) : undefined;
  return {
    ...defaultInvoiceFields,
    ...(await latestPaymentInstructions(workspaceId)),
    clientName: client?.name || "",
    contactPerson: client?.contactName || "",
    clientEmail: client?.email || "",
    clientPhone: client?.phone || "",
    items: [{ description: "Website design & development", quantity: 1, unitPrice: quote.total }],
  };
}

function assemble(workspace: WorkspaceRow, quote: QuoteRow, document: QuoteDocRow | undefined, fields: InvoiceFields): QuoteBundle {
  const view = buildInvoiceView({
    kind: "quote",
    number: quote.number,
    storedStatus: quote.status,
    issueDate: document?.createdAt ?? quote.createdAt,
    dueDate: quote.validUntil,
    sent: Boolean(document?.sentAt),
    business: { name: workspace.name, address: workspace.businessAddress || "", email: workspace.businessEmail || "", phone: workspace.businessPhone || "" },
    fields,
    payments: [],
    decision: document ? { decision: document.decision, by: document.decidedByName, at: document.decidedAt, note: document.decisionNote } : undefined,
  });
  return { quote, document, fields, view, workspace };
}

export async function loadQuoteBundle(workspaceId: string, quoteId: string): Promise<QuoteBundle | undefined> {
  const [quote, document, workspace] = await Promise.all([getQuote(workspaceId, quoteId), getQuoteDocument(quoteId), getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0])]);
  if (!quote || !workspace) return undefined;
  const fields = document ? withDefaults(document.fields as Partial<InvoiceFields>) : await defaultFields(workspaceId, quote);
  return assemble(workspace, quote, document, fields);
}

export async function nextQuoteNumber(workspaceId: string, now = new Date()) {
  const prefix = `QT-${now.getFullYear()}-`;
  const used = await getDb().select({ number: quotes.number }).from(quotes).where(and(eq(quotes.workspaceId, workspaceId), like(quotes.number, `${prefix}%`)));
  const highest = used.reduce((max, r) => { const m = new RegExp(`^${prefix}(\\d+)$`).exec(r.number); return m ? Math.max(max, Number(m[1])) : max; }, 0);
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

async function clientIdByName(workspaceId: string, name: string) {
  return getDb().select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, name.trim()))).limit(1).then((r) => r[0]?.id ?? null);
}

/** The quotes table keeps the KES value so lists and dashboards add up in one currency. */
const kesTotal = (fields: InvoiceFields) => Math.round(computeInvoiceTotals(fields.items, fields.discount).total * rateOf(fields));

export async function createQuoteWithDocument(workspaceId: string, userId: string, input: { fields: InvoiceFields; validUntil: Date; projectId?: string | null }) {
  for (let attempt = 0; ; attempt++) {
    const number = await nextQuoteNumber(workspaceId);
    try {
      return await getDb().transaction(async (tx) => {
        const clientId = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, input.fields.clientName))).limit(1).then((r) => r[0]?.id ?? null);
        const total = kesTotal(input.fields);
        const quote = await tx.insert(quotes).values({ workspaceId, clientId, projectId: input.projectId ?? null, number, status: "draft", subtotal: total, total, validUntil: input.validUntil }).returning().then((r) => r[0]);
        await tx.insert(quoteDocuments).values({ workspaceId, quoteId: quote.id, fields: input.fields, createdByUserId: userId });
        return quote;
      });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
      if (attempt < 4 && code === "23505") continue;
      throw error;
    }
  }
}

export async function saveQuoteDocument(workspaceId: string, userId: string, quoteId: string, fields: InvoiceFields, validUntil?: Date) {
  await getDb().insert(quoteDocuments).values({ workspaceId, quoteId, fields, createdByUserId: userId })
    .onConflictDoUpdate({ target: quoteDocuments.quoteId, set: { fields, updatedAt: new Date() }, where: eq(quoteDocuments.workspaceId, workspaceId) });
  const total = kesTotal(fields);
  await getDb().update(quotes).set({ subtotal: total, total, clientId: await clientIdByName(workspaceId, fields.clientName), ...(validUntil ? { validUntil } : {}), updatedAt: new Date() }).where(and(eq(quotes.workspaceId, workspaceId), eq(quotes.id, quoteId)));
}

export async function markQuoteSent(workspaceId: string, quoteId: string, channel: "email" | "whatsapp") {
  await getDb().update(quoteDocuments).set({ sentAt: new Date(), lastSentChannel: channel, updatedAt: new Date() }).where(eq(quoteDocuments.quoteId, quoteId));
  const quote = await getQuote(workspaceId, quoteId);
  if (quote && quote.status === "draft") await getDb().update(quotes).set({ status: "sent", updatedAt: new Date() }).where(eq(quotes.id, quoteId));
}

export function quoteViewUrl(document: Pick<QuoteDocRow, "id" | "shareVersion">) {
  return publicUrl(`/quotes/view/${createShareToken(LINK_KIND, document.id, document.shareVersion)}`);
}

export async function loadQuoteBundleByToken(token: string): Promise<QuoteBundle | undefined> {
  const id = shareTokenId(token);
  if (!id) return undefined;
  const document = await getDb().select().from(quoteDocuments).where(eq(quoteDocuments.id, id)).limit(1).then((r) => r[0]);
  if (!document || !verifyShareToken(LINK_KIND, token, document.shareVersion)) return undefined;
  const [quote, workspace] = await Promise.all([
    getDb().select().from(quotes).where(eq(quotes.id, document.quoteId)).limit(1).then((r) => r[0]),
    getDb().select().from(workspaces).where(eq(workspaces.id, document.workspaceId)).limit(1).then((r) => r[0]),
  ]);
  if (!quote || !workspace) return undefined;
  return assemble(workspace, quote, document, withDefaults(document.fields as Partial<InvoiceFields>));
}

/** Records the client's answer once. Returns why it can't be recorded, if so. */
export async function decideQuote(bundle: QuoteBundle, decision: "accepted" | "declined", name: string, note: string | null) {
  if (!bundle.document) return "NOT_SENT" as const;
  if (bundle.document.decision) return "ALREADY_DECIDED" as const;
  if (decision === "accepted" && bundle.view.status === "EXPIRED") return "EXPIRED" as const;
  await getDb().update(quoteDocuments).set({ decision, decidedByName: name, decisionNote: note, decidedAt: new Date(), updatedAt: new Date() }).where(eq(quoteDocuments.id, bundle.document.id));
  await getDb().update(quotes).set({ status: decision, updatedAt: new Date() }).where(eq(quotes.id, bundle.quote.id));
  return null;
}

export function buildQuoteDrafts(view: InvoiceView, clientEmail: string, clientPhone: string, viewUrl: string) {
  const sender = view.business.name || "45Creatives";
  const greeting = `Hi ${view.billTo.contact || view.billTo.client},`;
  const summary = [view.project.name ? `Project: ${view.project.name}` : null, `Total: ${formatInvoiceMoney(view.totals.total, view.currency)}`, `Valid until: ${view.dueDate}`].filter(Boolean) as string[];
  const body = [greeting, "", `Here is quotation ${view.number} from ${sender}.`, ...summary, "", "View it, download the PDF and accept online here:", viewUrl, "", "Regards,", sender].join("\n");
  const whatsapp = [greeting, "", `Quotation ${view.number} from ${sender} is ready.`, ...summary, "", "View and accept it here:", viewUrl].join("\n");
  return {
    waLink: clientPhone ? buildWhatsAppLink(clientPhone, whatsapp) : null,
    emailDraftUrl: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(clientEmail)}&su=${encodeURIComponent(`Quotation ${view.number} from ${sender}`)}&body=${encodeURIComponent(body)}`,
  };
}
