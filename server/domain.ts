import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { clients, leads, projects, quotes, invoices, payments, inventoryItems, transactions } from "../drizzle/schema.js";
import { syncPaymentTransaction } from "./crm.js";

type Row = { id: string; tableName: string; recordData: string[] };
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();
const money = (value = "") => Math.max(0, Math.round(Number(value.replace(/[^0-9.-]/g, "")) || 0));
const date = (value?: string) => { if (!value) return new Date(); const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? new Date() : parsed; };
const clean = (value?: string) => value?.trim() || null;
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, "-");
/** Converts a raw db enum value ("in-progress") into the human label the UI expects
 * ("In Progress") - the inverse of `normalize`. Freshly-loaded rows carry raw enum text
 * straight from Postgres; rows a user has edited this session carry whatever label text
 * they typed. Applying this at read time keeps both paths showing the same nice label. */
const titleCase = (value: string) => value.split(/[-_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const leadStatuses = new Set(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost", "nurturing"]);
const projectStatuses = new Set(["planning", "in-progress", "on-hold", "completed", "cancelled"]);
const invoiceStatuses = new Set(["draft", "sent", "partial", "paid", "overdue", "void"]);
const paymentStatuses = new Set(["pending", "completed", "failed", "refunded"]);
const transactionTypes = new Set(["income", "expense", "transfer"]);

function value(row: Row, index: number) { return row.recordData[index] ?? ""; }
function status(valueIn: string, allowed: Set<string>, fallback: string) { const v = normalize(valueIn); return allowed.has(v) ? v : fallback; }

async function syncClients(workspaceId: string, userId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(clients).values({ id: uuid(r.id), workspaceId, name: value(r,0) || "Unnamed client", company: value(r,0) || null, email: clean(value(r,2)), phone: clean(value(r,3)), status: normalize(value(r,5) || "active"), createdByUserId: userId, updatedAt: new Date() }).onConflictDoUpdate({ target: clients.id, set: { name: value(r,0) || "Unnamed client", company: value(r,0) || null, email: clean(value(r,2)), phone: clean(value(r,3)), status: normalize(value(r,5) || "active"), updatedAt: new Date() } });
}
async function syncLeads(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(leads).values({ id: uuid(r.id), workspaceId, name: value(r,0) || "Unnamed lead", company: clean(value(r,1)), source: clean(value(r,2)), estimatedValue: money(value(r,3)), status: status(value(r,4), leadStatuses, "new") as any, updatedAt: new Date() }).onConflictDoUpdate({ target: leads.id, set: { name: value(r,0) || "Unnamed lead", company: clean(value(r,1)), source: clean(value(r,2)), estimatedValue: money(value(r,3)), status: status(value(r,4), leadStatuses, "new") as any, updatedAt: new Date() } });
}
async function syncProjects(workspaceId: string, userId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(projects).values({ id: uuid(r.id), workspaceId, name: value(r,0) || "Unnamed project", progress: Math.min(100, Math.max(0, Number(value(r,2)) || 0)), status: status(value(r,3), projectStatuses, "planning") as any, dueDate: date(value(r,5)), budget: money(value(r,6)), createdByUserId: userId, updatedAt: new Date() }).onConflictDoUpdate({ target: projects.id, set: { name: value(r,0) || "Unnamed project", progress: Math.min(100, Math.max(0, Number(value(r,2)) || 0)), status: status(value(r,3), projectStatuses, "planning") as any, dueDate: date(value(r,5)), budget: money(value(r,6)), updatedAt: new Date() } });
}
async function syncQuotes(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(quotes).values({ id: uuid(r.id), workspaceId, number: value(r,0) || `QT-${Date.now()}`, status: normalize(value(r,4) || "draft"), subtotal: money(value(r,3)), total: money(value(r,3)), validUntil: date(value(r,5)), updatedAt: new Date() }).onConflictDoUpdate({ target: quotes.id, set: { number: value(r,0) || `QT-${Date.now()}`, status: normalize(value(r,4) || "draft"), subtotal: money(value(r,3)), total: money(value(r,3)), validUntil: date(value(r,5)), updatedAt: new Date() } });
}
async function syncInvoices(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(invoices).values({ id: uuid(r.id), workspaceId, number: value(r,0) || `INV-${Date.now()}`, status: status(value(r,5), invoiceStatuses, "draft") as any, total: money(value(r,4)), subtotal: money(value(r,4)), issueDate: date(value(r,2)), dueDate: date(value(r,3)), updatedAt: new Date() }).onConflictDoUpdate({ target: invoices.id, set: { number: value(r,0) || `INV-${Date.now()}`, status: status(value(r,5), invoiceStatuses, "draft") as any, total: money(value(r,4)), subtotal: money(value(r,4)), issueDate: date(value(r,2)), dueDate: date(value(r,3)), updatedAt: new Date() } });
}
async function syncPayments(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) {
    const saved = await db.insert(payments).values({ id: uuid(r.id), workspaceId, number: value(r,0) || `PAY-${Date.now()}`, amount: money(value(r,4)), method: clean(value(r,5)), status: status(value(r,6), paymentStatuses, "completed") as any, paidAt: date(value(r,3)) }).onConflictDoUpdate({ target: payments.id, set: { number: value(r,0) || `PAY-${Date.now()}`, amount: money(value(r,4)), method: clean(value(r,5)), status: status(value(r,6), paymentStatuses, "completed") as any, paidAt: date(value(r,3)) } }).returning().then(rows => rows[0]);
    if (saved) await syncPaymentTransaction(workspaceId, saved);
  }
}
async function syncInventory(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(inventoryItems).values({ id: uuid(r.id), workspaceId, name: value(r,0) || "Unnamed item", category: value(r,1) || "General", sku: clean(value(r,2)), quantity: Math.max(0, Number(value(r,3)) || 0), unitCost: money(value(r,4)), reorderLevel: 1, updatedAt: new Date() }).onConflictDoUpdate({ target: inventoryItems.id, set: { name: value(r,0) || "Unnamed item", category: value(r,1) || "General", sku: clean(value(r,2)), quantity: Math.max(0, Number(value(r,3)) || 0), unitCost: money(value(r,4)), updatedAt: new Date() } });
}
async function syncTransactions(workspaceId: string, rows: Row[]) {
  const db = getDb();
  for (const r of rows) await db.insert(transactions).values({ id: uuid(r.id), workspaceId, reference: clean(value(r,1)), description: value(r,2) || "Transaction", type: status(value(r,3), transactionTypes, "expense") as any, amount: money(value(r,4)), transactionDate: date(value(r,0)) }).onConflictDoUpdate({ target: transactions.id, set: { reference: clean(value(r,1)), description: value(r,2) || "Transaction", type: status(value(r,3), transactionTypes, "expense") as any, amount: money(value(r,4)), transactionDate: date(value(r,0)) } });
}


export async function syncDomainRows(workspaceId: string, userId: string, rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) grouped.set(row.tableName, [...(grouped.get(row.tableName) || []), row]);
  const db = getDb();
  await db.transaction(async () => {
    if (grouped.has("clients")) await syncClients(workspaceId, userId, grouped.get("clients")!);
    if (grouped.has("leads")) await syncLeads(workspaceId, grouped.get("leads")!);
    if (grouped.has("projects")) await syncProjects(workspaceId, userId, grouped.get("projects")!);
    if (grouped.has("quotes")) await syncQuotes(workspaceId, grouped.get("quotes")!);
    if (grouped.has("invoices")) await syncInvoices(workspaceId, grouped.get("invoices")!);
    if (grouped.has("payments")) await syncPayments(workspaceId, grouped.get("payments")!);
    if (grouped.has("inventory")) await syncInventory(workspaceId, grouped.get("inventory")!);
    if (grouped.has("transactions")) await syncTransactions(workspaceId, grouped.get("transactions")!);
  });
}

export async function deleteDomainRows(workspaceId: string, tableName: string, ids: string[]) {
  if (!ids.length) return;
  const db = getDb();
  const validIds = ids.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  if (!validIds.length) return;
  if (tableName === "clients") await db.delete(clients).where(and(eq(clients.workspaceId, workspaceId), inArray(clients.id, validIds)));
  else if (tableName === "leads") await db.delete(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.id, validIds)));
  else if (tableName === "projects") await db.delete(projects).where(and(eq(projects.workspaceId, workspaceId), inArray(projects.id, validIds)));
  else if (tableName === "quotes") await db.delete(quotes).where(and(eq(quotes.workspaceId, workspaceId), inArray(quotes.id, validIds)));
  else if (tableName === "invoices") await db.delete(invoices).where(and(eq(invoices.workspaceId, workspaceId), inArray(invoices.id, validIds)));
  else if (tableName === "payments") {
    const removed = await db.select({ number: payments.number }).from(payments).where(and(eq(payments.workspaceId, workspaceId), inArray(payments.id, validIds)));
    await db.delete(payments).where(and(eq(payments.workspaceId, workspaceId), inArray(payments.id, validIds)));
    const refs = removed.map(r => r.number);
    if (refs.length) await db.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.reference, refs)));
  }
  else if (tableName === "inventory") await db.delete(inventoryItems).where(and(eq(inventoryItems.workspaceId, workspaceId), inArray(inventoryItems.id, validIds)));
  else if (tableName === "transactions") await db.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, validIds)));
}

export async function listDomainRows(workspaceId: string) {
  const db = getDb();
  const [c,l,p,q,i,pa,inv,t] = await Promise.all([
    db.select().from(clients).where(eq(clients.workspaceId, workspaceId)), db.select().from(leads).where(eq(leads.workspaceId, workspaceId)),
    db.select().from(projects).where(eq(projects.workspaceId, workspaceId)), db.select().from(quotes).where(eq(quotes.workspaceId, workspaceId)),
    db.select().from(invoices).where(eq(invoices.workspaceId, workspaceId)), db.select().from(payments).where(eq(payments.workspaceId, workspaceId)),
    db.select().from(inventoryItems).where(eq(inventoryItems.workspaceId, workspaceId)), db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId)),
  ]);
  const moneyText = (n:number) => `KSh ${n.toLocaleString("en-KE")}`;
  return [
    ...c.map(r=>({id:r.id,tableName:"clients",recordData:[r.name,r.name,r.email||"",r.phone||"",moneyText(0),titleCase(r.status),r.status]})),
    ...l.map(r=>({id:r.id,tableName:"leads",recordData:[r.name,r.company||"",r.source||"",moneyText(r.estimatedValue),titleCase(r.status),r.status,"Nadia Rachel"]})),
    ...p.map(r=>({id:r.id,tableName:"projects",recordData:[r.name,"Client",String(r.progress),titleCase(r.status),r.status,r.dueDate?.toLocaleDateString("en-KE")||"",moneyText(r.budget)]})),
    ...q.map(r=>({id:r.id,tableName:"quotes",recordData:[r.number,"Client","Project",moneyText(r.total),titleCase(r.status),r.status,r.validUntil?.toLocaleDateString("en-KE")||""]})),
    ...i.map(r=>({id:r.id,tableName:"invoices",recordData:[r.number,"Client",r.issueDate.toLocaleDateString("en-KE"),r.dueDate?.toLocaleDateString("en-KE")||"",moneyText(r.total),titleCase(r.status),r.status]})),
    ...pa.map(r=>({id:r.id,tableName:"payments",recordData:[r.number,"Client","Invoice",r.paidAt.toLocaleDateString("en-KE"),moneyText(r.amount),r.method||"",titleCase(r.status),r.status]})),
    ...inv.map(r=>({id:r.id,tableName:"inventory",recordData:[r.name,r.category,r.sku||"",String(r.quantity),moneyText(r.unitCost),moneyText(r.quantity*r.unitCost),r.quantity<=r.reorderLevel?(r.quantity===0?"Out of Stock":"Low Stock"):"In Stock",r.quantity===0?"overdue":r.quantity<=r.reorderLevel?"pending":"active"]})),
    ...t.map(r=>({id:r.id,tableName:"transactions",recordData:[r.transactionDate.toLocaleDateString("en-KE"),r.reference||"",r.description,titleCase(r.type),moneyText(r.amount),r.type==="income"?"positive":"negative"]})),
  ];
}
