import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { clients, leads, projects, quotes, quoteDocuments, invoices, payments, inventoryItems, transactions, users, workspaceMembers } from "../drizzle/schema.js";
import { syncPaymentTransaction } from "./crm.js";
import { listInvoiceSummaries, refreshInvoiceSummary, type InvoiceSummary } from "./invoiceDocs.js";

type Row = { id: string; tableName: string; recordData: string[] };
type Db = ReturnType<typeof getDb>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value: string) => uuidPattern.test(value) ? value : randomUUID();
const money = (value = "") => Math.max(0, Math.round(Number(value.replace(/[^0-9.-]/g, "")) || 0));
const date = (value?: string) => {
  if (!value) return new Date();
  // Rows the server itself listed carry en-KE "dd/mm/yyyy" dates, which `new Date()` rejects (or
  // misreads as mm/dd). Parse them explicitly so a re-sync never resets a stored date to "now".
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (dmy) { const parsed = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))); return Number.isNaN(parsed.getTime()) ? new Date() : parsed; }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
/** Like `date`, but an empty cell stays empty instead of becoming "today". */
const optionalDate = (value?: string) => value?.trim() ? date(value) : null;
/** Dates are shown in Nairobi time so the server's own timezone never shifts a day. */
const dayText = (value: Date | null | undefined) => value ? value.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" }) : "";
const clean = (value?: string) => value?.trim() || null;
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "-");
const key = (value: string | null | undefined) => (value || "").trim().toLowerCase();
/** Converts a raw db enum value ("in-progress") into the human label the UI expects
 * ("In Progress") - the inverse of `normalize`. Freshly-loaded rows carry raw enum text
 * straight from Postgres; rows a user has edited this session carry whatever label text
 * they typed. Applying this at read time keeps both paths showing the same nice label. */
const titleCase = (value: string) => value.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const leadStatuses = new Set(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost", "nurturing"]);
const projectStatuses = new Set(["planning", "in-progress", "on-hold", "completed", "cancelled"]);
const paymentStatuses = new Set(["pending", "completed", "failed", "refunded"]);
const transactionTypes = new Set(["income", "expense", "transfer"]);

function value(row: Row, index: number) { return row.recordData[index] ?? ""; }
function status(valueIn: string, allowed: Set<string>, fallback: string) { const v = normalize(valueIn); return allowed.has(v) ? v : fallback; }

/** Name -> id lookups, loaded once per sync so linking rows by the name shown in the table
 * doesn't cost a query per row. Rows are linked by the visible client / project / invoice
 * text because that is what the table editor lets people type or pick. */
async function lookups(db: Db, workspaceId: string) {
  const [clientRows, projectRows, invoiceRows, memberRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.workspaceId, workspaceId)),
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.workspaceId, workspaceId)),
    db.select({ id: invoices.id, number: invoices.number, clientId: invoices.clientId }).from(invoices).where(eq(invoices.workspaceId, workspaceId)),
    db.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId)),
  ]);
  const byName = <T extends { id: string }>(rows: T[], label: (row: T) => string) => new Map(rows.map((row) => [key(label(row)), row]));
  const clientsByName = byName(clientRows, (r) => r.name);
  const projectsByName = byName(projectRows, (r) => r.name);
  const invoicesByNumber = byName(invoiceRows, (r) => r.number);
  const membersByName = byName(memberRows, (r) => r.name);
  return {
    clientId: (name: string) => clientsByName.get(key(name))?.id ?? null,
    projectId: (name: string) => projectsByName.get(key(name))?.id ?? null,
    invoice: (number: string) => invoicesByNumber.get(key(number)) ?? null,
    memberId: (name: string) => membersByName.get(key(name))?.id ?? null,
  };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;

async function syncClients(db: Db, workspaceId: string, userId: string, rows: Row[]) {
  for (const r of rows) {
    const set = { name: value(r,0) || "Unnamed client", contactName: clean(value(r,1)), email: clean(value(r,2)), phone: clean(value(r,3)), status: normalize(value(r,5) || "active"), updatedAt: new Date() };
    await db.insert(clients).values({ id: uuid(r.id), workspaceId, createdByUserId: userId, ...set }).onConflictDoUpdate({ target: clients.id, set, where: eq(clients.workspaceId, workspaceId) });
  }
}
async function syncLeads(db: Db, workspaceId: string, rows: Row[], find: Lookups) {
  for (const r of rows) {
    const set = { name: value(r,0) || "Unnamed lead", company: clean(value(r,1)), source: clean(value(r,2)), estimatedValue: money(value(r,3)), status: status(value(r,4), leadStatuses, "new") as typeof leads.$inferInsert["status"], assignedToUserId: find.memberId(value(r,6)), email: clean(value(r,7)), phone: clean(value(r,8)), updatedAt: new Date() };
    await db.insert(leads).values({ id: uuid(r.id), workspaceId, ...set }).onConflictDoUpdate({ target: leads.id, set, where: eq(leads.workspaceId, workspaceId) });
  }
}
async function syncProjects(db: Db, workspaceId: string, userId: string, rows: Row[], find: Lookups) {
  for (const r of rows) {
    const set = { name: value(r,0) || "Unnamed project", clientId: find.clientId(value(r,1)), progress: Math.min(100, Math.max(0, Number(value(r,2)) || 0)), status: status(value(r,3), projectStatuses, "planning") as typeof projects.$inferInsert["status"], dueDate: optionalDate(value(r,5)), budget: money(value(r,6)), updatedAt: new Date() };
    await db.insert(projects).values({ id: uuid(r.id), workspaceId, createdByUserId: userId, ...set }).onConflictDoUpdate({ target: projects.id, set, where: eq(projects.workspaceId, workspaceId) });
  }
}
async function syncQuotes(db: Db, workspaceId: string, rows: Row[], find: Lookups) {
  // A quote with line items keeps the total worked out from them; the row's value is only a summary.
  const detailed = new Set((await db.select({ quoteId: quoteDocuments.quoteId }).from(quoteDocuments).where(eq(quoteDocuments.workspaceId, workspaceId))).map((d) => d.quoteId));
  for (const r of rows) {
    const total = money(value(r,3));
    const amounts = detailed.has(r.id) ? {} : { subtotal: total, total };
    const set = { number: value(r,0) || `QT-${Date.now()}`, clientId: find.clientId(value(r,1)), projectId: find.projectId(value(r,2)), status: normalize(value(r,4) || "draft"), ...amounts, validUntil: optionalDate(value(r,6)), updatedAt: new Date() };
    await db.insert(quotes).values({ id: uuid(r.id), workspaceId, subtotal: total, total, ...set }).onConflictDoUpdate({ target: quotes.id, set, where: eq(quotes.workspaceId, workspaceId) });
  }
}
/** Upserts payments and reports what changed, so the ledger and invoice totals can be refreshed
 * once the transaction has committed (those helpers read through their own connection). */
async function syncPayments(db: Db, workspaceId: string, rows: Row[], find: Lookups) {
  const touchedInvoices = new Set<string>();
  const savedPayments: (typeof payments.$inferSelect)[] = [];
  for (const r of rows) {
    // A payment moved to another invoice must also refresh the invoice it left.
    const previous = await db.select({ invoiceId: payments.invoiceId }).from(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.id, uuid(r.id)))).limit(1).then(found => found[0]?.invoiceId);
    if (previous) touchedInvoices.add(previous);
    // Link the payment to its invoice by invoice number so invoices can show payments received.
    const invoice = find.invoice(value(r,2));
    const set = { invoiceId: invoice?.id ?? null, clientId: invoice?.clientId ?? find.clientId(value(r,1)), number: value(r,0) || `PAY-${Date.now()}`, amount: money(value(r,4)), method: clean(value(r,5)), status: status(value(r,6), paymentStatuses, "completed") as typeof payments.$inferInsert["status"], paidAt: date(value(r,3)) };
    const saved = await db.insert(payments).values({ id: uuid(r.id), workspaceId, ...set }).onConflictDoUpdate({ target: payments.id, set, where: eq(payments.workspaceId, workspaceId) }).returning().then(found => found[0]);
    if (saved) savedPayments.push(saved);
    if (invoice) touchedInvoices.add(invoice.id);
  }
  return { savedPayments, touchedInvoices };
}
async function syncInventory(db: Db, workspaceId: string, rows: Row[]) {
  for (const r of rows) {
    const set = { name: value(r,0) || "Unnamed item", category: value(r,1) || "General", sku: clean(value(r,2)), quantity: Math.max(0, Number(value(r,3)) || 0), unitCost: money(value(r,4)), updatedAt: new Date() };
    await db.insert(inventoryItems).values({ id: uuid(r.id), workspaceId, reorderLevel: 1, ...set }).onConflictDoUpdate({ target: inventoryItems.id, set, where: eq(inventoryItems.workspaceId, workspaceId) });
  }
}
async function syncTransactions(db: Db, workspaceId: string, rows: Row[]) {
  for (const r of rows) {
    const set = { reference: clean(value(r,1)), description: value(r,2) || "Transaction", type: status(value(r,3), transactionTypes, "expense") as typeof transactions.$inferInsert["type"], amount: money(value(r,4)), transactionDate: date(value(r,0)) };
    await db.insert(transactions).values({ id: uuid(r.id), workspaceId, ...set }).onConflictDoUpdate({ target: transactions.id, set, where: eq(transactions.workspaceId, workspaceId) });
  }
}

/**
 * Saves rows edited in the dashboard tables. Invoices are not synced from here: they are created,
 * edited, sent and voided through `invoiceDocs`, and their totals and status are always worked out
 * by the server from the saved details and payments.
 */
export async function syncDomainRows(workspaceId: string, userId: string, rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.tableName, [...(grouped.get(row.tableName) || []), row]);
  const paymentChanges = await getDb().transaction(async (tx) => {
    const db = tx as unknown as Db;
    // Clients and projects go first so the lookups below can link rows created in the same batch.
    if (grouped.has("clients")) await syncClients(db, workspaceId, userId, grouped.get("clients")!);
    if (grouped.has("projects")) await syncProjects(db, workspaceId, userId, grouped.get("projects")!, await lookups(db, workspaceId));
    const find = await lookups(db, workspaceId);
    if (grouped.has("leads")) await syncLeads(db, workspaceId, grouped.get("leads")!, find);
    if (grouped.has("quotes")) await syncQuotes(db, workspaceId, grouped.get("quotes")!, find);
    if (grouped.has("inventory")) await syncInventory(db, workspaceId, grouped.get("inventory")!);
    if (grouped.has("transactions")) await syncTransactions(db, workspaceId, grouped.get("transactions")!);
    return grouped.has("payments") ? syncPayments(db, workspaceId, grouped.get("payments")!, find) : null;
  });
  if (!paymentChanges) return;
  for (const payment of paymentChanges.savedPayments) await syncPaymentTransaction(workspaceId, payment);
  for (const invoiceId of paymentChanges.touchedInvoices) await refreshInvoiceSummary(workspaceId, invoiceId);
}

export async function deleteDomainRows(workspaceId: string, tableName: string, ids: string[]) {
  if (!ids.length) return;
  const db = getDb();
  const validIds = ids.filter(id => uuidPattern.test(id));
  if (!validIds.length) return;
  if (tableName === "clients") await db.delete(clients).where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, validIds)));
  else if (tableName === "leads") await db.delete(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.id, validIds)));
  else if (tableName === "projects") await db.delete(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, validIds)));
  else if (tableName === "quotes") await db.delete(quotes).where(and(eq(quotes.workspaceId, workspaceId), inArray(quotes.id, validIds)));
  else if (tableName === "invoices") await db.delete(invoices).where(and(eq(invoices.workspaceId, workspaceId), inArray(invoices.id, validIds)));
  else if (tableName === "payments") {
    const removed = await db.select({ number: payments.number, invoiceId: payments.invoiceId }).from(payments).where(and(eq(payments.workspaceId, workspaceId), inArray(payments.id, validIds)));
    await db.delete(payments).where(and(eq(payments.workspaceId, workspaceId), inArray(payments.id, validIds)));
    const refs = removed.map(r => r.number);
    if (refs.length) await db.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.reference, refs)));
    for (const invoiceId of new Set(removed.map(r => r.invoiceId).filter((id): id is string => Boolean(id)))) await refreshInvoiceSummary(workspaceId, invoiceId);
  }
  else if (tableName === "inventory") await db.delete(inventoryItems).where(and(eq(inventoryItems.workspaceId, workspaceId), inArray(inventoryItems.id, validIds)));
  else if (tableName === "transactions") await db.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, validIds)));
}

/** Tone the dashboard uses for an invoice: paid, pending (awaiting payment), overdue, draft or void. */
export function invoiceTone(status: InvoiceSummary["status"]) {
  return status === "PAID" ? "paid" : status === "OVERDUE" ? "overdue" : status === "DRAFT" ? "draft" : status === "VOID" ? "void" : "pending";
}

/**
 * Every dashboard table as positional string rows. Column order per table:
 * - clients:      name, primary contact, email, phone, outstanding, status label, status
 * - leads:        name, company, source, value, status label, status, assigned to, email, phone
 * - projects:     name, client, progress, status label, status, due date, budget
 * - quotes:       number, client, project, value, status label, status, valid until
 * - invoices:     number, client, issued, due, total, display status, tone, balance (amounts in KES)
 * - payments:     number, client, invoice, date, amount, method, status label, status
 * - inventory:    item, category, sku, qty, unit cost, stock value, stock label, tone
 * - transactions: date, reference, description, type label, amount, positive | negative | neutral
 */
export async function listDomainRows(workspaceId: string) {
  const db = getDb();
  const [c,l,p,q,pa,inv,t,members,invoiceSummaries] = await Promise.all([
    db.select().from(clients).where(eq(clients.workspaceId, workspaceId)), db.select().from(leads).where(eq(leads.workspaceId, workspaceId)),
    db.select().from(projects).where(eq(projects.workspaceId, workspaceId)), db.select().from(quotes).where(eq(quotes.workspaceId, workspaceId)),
    db.select().from(payments).where(eq(payments.workspaceId, workspaceId)),
    db.select().from(inventoryItems).where(eq(inventoryItems.workspaceId, workspaceId)), db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId)),
    db.select({ id: users.id, name: users.name }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId)),
    listInvoiceSummaries(workspaceId),
  ]);
  const moneyText = (n:number) => `KSh ${n.toLocaleString("en-KE")}`;
  const clientNames = new Map(c.map(r => [r.id, r.name]));
  const projectNames = new Map(p.map(r => [r.id, r.name]));
  const memberNames = new Map(members.map(r => [r.id, r.name]));
  const invoicesById = new Map(invoiceSummaries.map(i => [i.id, i]));
  const outstandingByClient = new Map<string, number>();
  for (const i of invoiceSummaries) if (i.status === "UNPAID" || i.status === "PART-PAID" || i.status === "OVERDUE") outstandingByClient.set(key(i.clientName), (outstandingByClient.get(key(i.clientName)) || 0) + i.balanceKes);
  const name = (map: Map<string, string>, id: string | null) => id ? map.get(id) || "" : "";
  return [
    ...c.map(r=>({id:r.id,tableName:"clients",recordData:[r.name,r.contactName||"",r.email||"",r.phone||"",moneyText(outstandingByClient.get(key(r.name)) || 0),titleCase(r.status),r.status]})),
    ...l.map(r=>({id:r.id,tableName:"leads",recordData:[r.name,r.company||"",r.source||"",moneyText(r.estimatedValue),titleCase(r.status),r.status,name(memberNames, r.assignedToUserId)||"Unassigned",r.email||"",r.phone||""]})),
    ...p.map(r=>({id:r.id,tableName:"projects",recordData:[r.name,name(clientNames, r.clientId),String(r.progress),titleCase(r.status),r.status,dayText(r.dueDate),moneyText(r.budget)]})),
    ...q.map(r=>({id:r.id,tableName:"quotes",recordData:[r.number,name(clientNames, r.clientId),name(projectNames, r.projectId),moneyText(r.total),titleCase(r.status),r.status,dayText(r.validUntil)]})),
    ...invoiceSummaries.map(i=>({id:i.id,tableName:"invoices",recordData:[i.number,i.clientName,dayText(i.issueDate),dayText(i.dueDate),moneyText(i.totalKes),i.status,invoiceTone(i.status),moneyText(i.balanceKes)]})),
    ...pa.map(r=>{ const invoice = r.invoiceId ? invoicesById.get(r.invoiceId) : undefined; return {id:r.id,tableName:"payments",recordData:[r.number,name(clientNames, r.clientId)||invoice?.clientName||"",invoice?.number||"",dayText(r.paidAt),moneyText(r.amount),r.method||"",titleCase(r.status),r.status]}; }),
    ...inv.map(r=>({id:r.id,tableName:"inventory",recordData:[r.name,r.category,r.sku||"",String(r.quantity),moneyText(r.unitCost),moneyText(r.quantity*r.unitCost),r.quantity<=r.reorderLevel?(r.quantity===0?"Out of Stock":"Low Stock"):"In Stock",r.quantity===0?"overdue":r.quantity<=r.reorderLevel?"pending":"active"]})),
    ...t.map(r=>({id:r.id,tableName:"transactions",recordData:[dayText(r.transactionDate),r.reference||"",r.description,titleCase(r.type),moneyText(r.amount),r.type==="income"?"positive":r.type==="transfer"?"neutral":"negative"]})),
  ];
}
