import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db.js";
import { changeRequests, clients, contracts, invoiceDocuments, invoices, projectMilestones, projects, quoteDocuments, quotes, renewals, workspaces } from "../drizzle/schema.js";
import { createShareToken, publicUrl, shareTokenId, verifyShareToken } from "./shareLinks.js";
import { invoiceViewUrl, listInvoiceSummaries } from "./invoiceDocs.js";
import { quoteViewUrl } from "./quoteDocs.js";
import { listAssets } from "./vault.js";
import { buildInvoiceView, defaultInvoiceFields, type InvoiceFields } from "../shared/invoice.js";

const LINK_KIND = "client-portal";

export function portalUrl(client: { id: string; portalVersion: number }) {
  return publicUrl(`/portal/${createShareToken(LINK_KIND, client.id, client.portalVersion)}`);
}

/** The client a portal token belongs to, if the link is valid and the portal is switched on. */
export async function clientForPortalToken(token: string) {
  const id = shareTokenId(token);
  if (!id) return undefined;
  const client = await getDb().select().from(clients).where(eq(clients.id, id)).limit(1).then((r) => r[0]);
  if (!client || !client.portalEnabled || !verifyShareToken(LINK_KIND, token, client.portalVersion)) return undefined;
  return client;
}

export async function setPortal(workspaceId: string, clientId: string, action: "enable" | "disable" | "reset") {
  const client = await getDb().select().from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId))).limit(1).then((r) => r[0]);
  if (!client) return undefined;
  const next = action === "enable" ? { portalEnabled: true } : action === "disable" ? { portalEnabled: false } : { portalEnabled: true, portalVersion: client.portalVersion + 1 };
  const updated = await getDb().update(clients).set({ ...next, updatedAt: new Date() }).where(eq(clients.id, clientId)).returning().then((r) => r[0]);
  return { enabled: updated.portalEnabled, url: updated.portalEnabled ? portalUrl(updated) : null };
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

/** Everything the client may see: sent invoices and quotes, agreements, projects, shared files, renewals. */
export async function loadPortal(client: typeof clients.$inferSelect) {
  const db = getDb();
  const workspaceId = client.workspaceId;
  const [workspace, summaries, invoiceDocs, quoteRows, contractRows, projectRows, renewalRows, files] = await Promise.all([
    db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0]),
    listInvoiceSummaries(workspaceId),
    db.select().from(invoiceDocuments).where(eq(invoiceDocuments.workspaceId, workspaceId)),
    db.select({ quote: quotes, doc: quoteDocuments }).from(quotes).innerJoin(quoteDocuments, eq(quoteDocuments.quoteId, quotes.id)).where(eq(quotes.workspaceId, workspaceId)),
    db.select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId), or(eq(contracts.clientId, client.id), eq(contracts.clientName, client.name)))).orderBy(desc(contracts.createdAt)),
    db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.clientId, client.id))).orderBy(desc(projects.createdAt)),
    db.select().from(renewals).where(and(eq(renewals.workspaceId, workspaceId), or(eq(renewals.clientId, client.id), eq(renewals.clientName, client.name)), eq(renewals.status, "active"))).orderBy(asc(renewals.nextDueDate)),
    listAssets(workspaceId, client.id, true),
  ]);
  const docsByInvoice = new Map(invoiceDocs.map((d) => [d.invoiceId, d]));
  const projectIds = projectRows.map((p) => p.id);
  const [milestones, changes] = projectIds.length ? await Promise.all([
    db.select().from(projectMilestones).where(inArray(projectMilestones.projectId, projectIds)).orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.createdAt)),
    db.select().from(changeRequests).where(inArray(changeRequests.projectId, projectIds)).orderBy(desc(changeRequests.createdAt)),
  ]) : [[], []];
  const business = { name: workspace?.name || "", email: workspace?.businessEmail || "", phone: workspace?.businessPhone || "", address: workspace?.businessAddress || "" };
  return {
    client: { name: client.name, contactName: client.contactName },
    business,
    // Only invoices that were actually sent; drafts and voided ones stay private.
    invoices: summaries.filter((i) => same(i.clientName, client.name) && i.sentAt && i.status !== "DRAFT" && i.status !== "VOID").map((i) => {
      const doc = docsByInvoice.get(i.id);
      return { number: i.number, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, balance: i.balance, currency: i.currency, status: i.status, url: doc ? invoiceViewUrl(doc) : null };
    }),
    quotes: quoteRows.filter((q) => q.doc.sentAt && same((q.doc.fields as Partial<InvoiceFields>).clientName, client.name)).map((q) => {
      const fields = { ...defaultInvoiceFields, ...(q.doc.fields as Partial<InvoiceFields>) } as InvoiceFields;
      const view = buildInvoiceView({ kind: "quote", number: q.quote.number, storedStatus: q.quote.status, issueDate: q.doc.createdAt, dueDate: q.quote.validUntil, sent: true, business, fields, payments: [], decision: { decision: q.doc.decision, by: q.doc.decidedByName, at: q.doc.decidedAt, note: q.doc.decisionNote } });
      return { number: q.quote.number, total: view.totals.total, currency: view.currency, status: view.status, validUntil: q.quote.validUntil, url: quoteViewUrl(q.doc) };
    }),
    contracts: contractRows.filter((c) => c.status === "sent" || c.status === "signed").map((c) => ({ id: c.id, title: c.title, status: c.status, sentAt: c.sentAt, clientSignedAt: c.clientSignedAt })),
    projects: projectRows.map((p) => ({
      id: p.id, name: p.name, status: p.status, progress: p.progress, dueDate: p.dueDate,
      milestones: milestones.filter((m) => m.projectId === p.id).map((m) => ({ id: m.id, title: m.title, description: m.description, dueDate: m.dueDate, status: m.status, clientNote: m.clientNote, decidedByName: m.decidedByName, decidedAt: m.decidedAt })),
      changeRequests: changes.filter((c) => c.projectId === p.id).map((c) => ({ id: c.id, title: c.title, status: c.status, kind: c.kind, createdAt: c.createdAt, amount: c.amount })),
    })),
    files: files.map((f) => ({ id: f.id, kind: f.kind, name: f.name, url: f.kind === "link" ? f.url : null, sizeBytes: f.sizeBytes, mimeType: f.mimeType, source: f.source, createdAt: f.createdAt })),
    renewals: renewalRows.map((r) => ({ name: r.name, type: r.type, cycle: r.cycle, nextDueDate: r.nextDueDate, amount: r.amount })),
  };
}

/** Confirms a project belongs to the portal's client. */
export async function portalProject(client: typeof clients.$inferSelect, projectId: string) {
  return getDb().select().from(projects).where(and(eq(projects.workspaceId, client.workspaceId), eq(projects.id, projectId), eq(projects.clientId, client.id))).limit(1).then((r) => r[0]);
}

/** Confirms an agreement belongs to the portal's client and has been shared with them. */
export async function portalContract(client: typeof clients.$inferSelect, contractId: string) {
  const contract = await getDb().select().from(contracts).where(and(eq(contracts.workspaceId, client.workspaceId), eq(contracts.id, contractId))).limit(1).then((r) => r[0]);
  if (!contract || (contract.clientId !== client.id && !same(contract.clientName, client.name)) || contract.status !== "signed") return undefined;
  return contract;
}
