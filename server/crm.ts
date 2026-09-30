import { and, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { clients, leads, projects, quotes, invoices, payments, inventoryItems, transactions } from "../drizzle/schema.js";

export const crmTables = { clients, leads, projects, quotes, invoices, payments, inventoryItems, transactions };

export async function listCRM(workspaceId: string) {
  const db = getDb();
  const [clientRows, leadRows, projectRows, quoteRows, invoiceRows, paymentRows, inventoryRows, transactionRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.workspaceId, workspaceId)),
    db.select().from(leads).where(eq(leads.workspaceId, workspaceId)),
    db.select().from(projects).where(eq(projects.workspaceId, workspaceId)),
    db.select().from(quotes).where(eq(quotes.workspaceId, workspaceId)),
    db.select().from(invoices).where(eq(invoices.workspaceId, workspaceId)),
    db.select().from(payments).where(eq(payments.workspaceId, workspaceId)),
    db.select().from(inventoryItems).where(eq(inventoryItems.workspaceId, workspaceId)),
    db.select().from(transactions).where(eq(transactions.workspaceId, workspaceId)),
  ]);
  return { clients: clientRows, leads: leadRows, projects: projectRows, quotes: quoteRows, invoices: invoiceRows, payments: paymentRows, inventoryItems: inventoryRows, transactions: transactionRows };
}

export async function deleteClient(workspaceId: string, id: string) { await getDb().delete(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, id))); }
export async function deleteLead(workspaceId: string, id: string) { await getDb().delete(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, id))); }
export async function deleteProject(workspaceId: string, id: string) { await getDb().delete(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, id))); }
export async function deleteQuote(workspaceId: string, id: string) { await getDb().delete(quotes).where(and(eq(quotes.workspaceId, workspaceId), eq(quotes.id, id))); }
export async function deleteInvoice(workspaceId: string, id: string) { await getDb().delete(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, id))); }
export async function deletePayment(workspaceId: string, id: string) {
  const payment = await getDb().select().from(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.id, id))).limit(1).then(r => r[0]);
  await getDb().delete(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.id, id)));
  if (payment) await getDb().delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.reference, payment.number)));
}
export async function deleteInventoryItem(workspaceId: string, id: string) { await getDb().delete(inventoryItems).where(and(eq(inventoryItems.workspaceId, workspaceId), eq(inventoryItems.id, id))); }
export async function deleteTransaction(workspaceId: string, id: string) { await getDb().delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, id))); }

export async function upsertClient(workspaceId: string, userId: string, input: Omit<typeof clients.$inferInsert, "workspaceId">) {
  return getDb().insert(clients).values({ ...input, workspaceId, createdByUserId: input.createdByUserId ?? userId })
    .onConflictDoUpdate({ target: clients.id, set: { name: input.name, company: input.company, email: input.email, phone: input.phone, status: input.status, notes: input.notes, updatedAt: new Date() }, where: eq(clients.workspaceId, workspaceId) }).returning().then(r => r[0]);
}
export async function upsertLead(workspaceId: string, input: Omit<typeof leads.$inferInsert, "workspaceId">) {
  return getDb().insert(leads).values({ ...input, workspaceId }).onConflictDoUpdate({ target: leads.id, set: { clientId: input.clientId, name: input.name, company: input.company, email: input.email, phone: input.phone, source: input.source, status: input.status, estimatedValue: input.estimatedValue, assignedToUserId: input.assignedToUserId, updatedAt: new Date() }, where: eq(leads.workspaceId, workspaceId) }).returning().then(r => r[0]);
}

export async function upsertProject(workspaceId: string, userId: string, input: Omit<typeof projects.$inferInsert, "workspaceId">) {
  return getDb().insert(projects).values({ ...input, workspaceId, createdByUserId: input.createdByUserId ?? userId }).onConflictDoUpdate({ target: projects.id, set: { clientId: input.clientId, name: input.name, status: input.status, progress: input.progress, budget: input.budget, dueDate: input.dueDate, updatedAt: new Date() }, where: eq(projects.workspaceId, workspaceId) }).returning().then(r => r[0]);
}

export async function upsertQuote(workspaceId: string, input: Omit<typeof quotes.$inferInsert, "workspaceId">) {
  return getDb().insert(quotes).values({ ...input, workspaceId }).onConflictDoUpdate({ target: quotes.id, set: { clientId: input.clientId, projectId: input.projectId, number: input.number, status: input.status, subtotal: input.subtotal, tax: input.tax, total: input.total, validUntil: input.validUntil, updatedAt: new Date() }, where: eq(quotes.workspaceId, workspaceId) }).returning().then(r => r[0]);
}

export async function upsertInvoice(workspaceId: string, input: Omit<typeof invoices.$inferInsert, "workspaceId">) {
  return getDb().insert(invoices).values({ ...input, workspaceId }).onConflictDoUpdate({ target: invoices.id, set: { clientId: input.clientId, projectId: input.projectId, quoteId: input.quoteId, number: input.number, status: input.status, subtotal: input.subtotal, tax: input.tax, total: input.total, amountPaid: input.amountPaid, issueDate: input.issueDate, dueDate: input.dueDate, updatedAt: new Date() }, where: eq(invoices.workspaceId, workspaceId) }).returning().then(r => r[0]);
}

export async function upsertPayment(workspaceId: string, input: Omit<typeof payments.$inferInsert, "workspaceId">) {
  const payment = await getDb().insert(payments).values({ ...input, workspaceId }).onConflictDoUpdate({ target: payments.id, set: { invoiceId: input.invoiceId, clientId: input.clientId, number: input.number, amount: input.amount, method: input.method, status: input.status, paidAt: input.paidAt }, where: eq(payments.workspaceId, workspaceId) }).returning().then(r => r[0]);
  await syncPaymentTransaction(workspaceId, payment);
  return payment;
}

/** Keeps the Accounting ledger in sync with Payments automatically: a completed payment gets a
 * matching income transaction; a payment that is no longer completed has its transaction removed.
 * Idempotent - matches by `reference = payment.number`, so repeat calls never create duplicates. */
export async function syncPaymentTransaction(workspaceId: string, payment: typeof payments.$inferSelect) {
  const db = getDb();
  const existing = await db.select().from(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.reference, payment.number))).limit(1).then(r => r[0]);
  if (payment.status === "completed") {
    if (existing) {
      await db.update(transactions).set({ amount: payment.amount, transactionDate: payment.paidAt, description: `Payment received - ${payment.number}` }).where(eq(transactions.id, existing.id));
    } else {
      await db.insert(transactions).values({ workspaceId, reference: payment.number, description: `Payment received - ${payment.number}`, type: "income", amount: payment.amount, transactionDate: payment.paidAt });
    }
  } else if (existing) {
    await db.delete(transactions).where(eq(transactions.id, existing.id));
  }
}

export async function upsertInventoryItem(workspaceId: string, input: Omit<typeof inventoryItems.$inferInsert, "workspaceId">) {
  return getDb().insert(inventoryItems).values({ ...input, workspaceId }).onConflictDoUpdate({ target: inventoryItems.id, set: { name: input.name, category: input.category, sku: input.sku, quantity: input.quantity, unitCost: input.unitCost, reorderLevel: input.reorderLevel, updatedAt: new Date() }, where: eq(inventoryItems.workspaceId, workspaceId) }).returning().then(r => r[0]);
}

export async function upsertTransaction(workspaceId: string, input: Omit<typeof transactions.$inferInsert, "workspaceId">) {
  return getDb().insert(transactions).values({ ...input, workspaceId }).onConflictDoUpdate({ target: transactions.id, set: { reference: input.reference, description: input.description, type: input.type, amount: input.amount, transactionDate: input.transactionDate }, where: eq(transactions.workspaceId, workspaceId) }).returning().then(r => r[0]);
}
