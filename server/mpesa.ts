import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";
import * as db from "./db.js";
import { invoices, mpesaTransactions, payments, workspaces } from "../drizzle/schema.js";
import { syncPaymentTransaction } from "./crm.js";
import { listInvoiceSummaries, refreshInvoiceSummary } from "./invoiceDocs.js";
import { publicUrl } from "./shareLinks.js";

export async function ensureMpesaWebhookSecret(workspaceId: string) {
  const existing = await getDb().select({ secret: workspaces.mpesaWebhookSecret }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0]?.secret);
  if (existing) return existing;
  const secret = randomBytes(24).toString("hex");
  await getDb().update(workspaces).set({ mpesaWebhookSecret: secret, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  return secret;
}

export async function mpesaWebhookUrls(workspaceId: string) {
  const secret = await ensureMpesaWebhookSecret(workspaceId);
  const base = publicUrl(`/api/mpesa/c2b/${workspaceId}/${secret}`);
  return { confirmationUrl: `${base}/confirmation`, validationUrl: `${base}/validation` };
}

export async function workspaceForMpesaSecret(workspaceId: string, secret: string) {
  const row = await getDb().select({ id: workspaces.id, secret: workspaces.mpesaWebhookSecret }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0]);
  return row?.secret && row.secret === secret ? row.id : null;
}

export async function listMpesaTransactions(workspaceId: string) {
  return getDb().select({ tx: mpesaTransactions, invoiceNumber: invoices.number }).from(mpesaTransactions).leftJoin(invoices, eq(invoices.id, mpesaTransactions.invoiceId)).where(eq(mpesaTransactions.workspaceId, workspaceId)).orderBy(desc(mpesaTransactions.paidAt)).limit(100).then((rows) => rows.map((r) => ({ ...r.tx, invoiceNumber: r.invoiceNumber })));
}

/** Records the payment against the invoice: a Payments row, the ledger income, and the invoice's new balance. */
async function applyToInvoice(workspaceId: string, txId: string, invoiceId: string) {
  const tx = await getDb().select().from(mpesaTransactions).where(and(eq(mpesaTransactions.workspaceId, workspaceId), eq(mpesaTransactions.id, txId))).limit(1).then((r) => r[0]);
  const invoice = await getDb().select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId))).limit(1).then((r) => r[0]);
  if (!tx || !invoice) return "NOT_FOUND" as const;
  if (tx.paymentId) return "ALREADY_MATCHED" as const;
  // A payment with this M-Pesa code may already exist (e.g. typed in by hand): link to it instead of duplicating.
  const existing = await getDb().select().from(payments).where(and(eq(payments.workspaceId, workspaceId), eq(payments.number, tx.transId))).limit(1).then((r) => r[0]);
  const payment = existing ?? await getDb().insert(payments).values({ workspaceId, invoiceId, clientId: invoice.clientId, number: tx.transId, amount: tx.amount, method: "M-Pesa", status: "completed", paidAt: tx.paidAt }).returning().then((r) => r[0]);
  if (existing && existing.invoiceId !== invoiceId) await getDb().update(payments).set({ invoiceId, clientId: invoice.clientId }).where(eq(payments.id, existing.id));
  await syncPaymentTransaction(workspaceId, payment);
  await getDb().update(mpesaTransactions).set({ invoiceId, paymentId: payment.id, status: "matched" }).where(eq(mpesaTransactions.id, tx.id));
  await refreshInvoiceSummary(workspaceId, invoiceId);
  await db.appendDashboardActivity(workspaceId, [{ recordId: invoiceId, tableName: "invoices", action: "M-Pesa payment", detail: `M-Pesa ${tx.transId} for KSh ${tx.amount.toLocaleString("en-KE")}${tx.payerName ? ` from ${tx.payerName}` : ""} recorded against ${invoice.number}.`, actorUserId: null }]);
  return null;
}

/**
 * Finds the invoice an M-Pesa payment is for: the account reference is the invoice number (that's
 * what the invoice asks clients to enter). Without a usable reference, it matches only when exactly
 * one unpaid invoice has a balance equal to the amount paid.
 */
async function findInvoiceFor(workspaceId: string, accountRef: string | null, amount: number) {
  const all = await listInvoiceSummaries(workspaceId);
  const open = all.filter((i) => ["UNPAID", "PART-PAID", "OVERDUE"].includes(i.status));
  const ref = (accountRef || "").trim().toLowerCase().replace(/\s+/g, "");
  if (ref) {
    const byNumber = all.find((i) => i.number.toLowerCase().replace(/\s+/g, "") === ref && i.status !== "VOID");
    if (byNumber) return byNumber.id;
  }
  const byAmount = open.filter((i) => i.balanceKes === amount);
  return byAmount.length === 1 ? byAmount[0].id : null;
}

export type IncomingMpesa = { transId: string; amount: number; accountRef: string | null; payerName: string | null; payerPhone: string | null; paidAt: Date; source: "daraja" | "sms" | "manual"; raw?: unknown };

/** Stores an M-Pesa payment once (by transaction code) and records it against its invoice when it can be matched. */
export async function receiveMpesa(workspaceId: string, input: IncomingMpesa) {
  const inserted = await getDb().insert(mpesaTransactions).values({ workspaceId, transId: input.transId.toUpperCase(), amount: input.amount, accountRef: input.accountRef, payerName: input.payerName, payerPhone: input.payerPhone, paidAt: input.paidAt, source: input.source, raw: input.raw ?? null }).onConflictDoNothing().returning().then((r) => r[0]);
  if (!inserted) {
    const existing = await getDb().select().from(mpesaTransactions).where(and(eq(mpesaTransactions.workspaceId, workspaceId), eq(mpesaTransactions.transId, input.transId.toUpperCase()))).limit(1).then((r) => r[0]);
    return { duplicate: true as const, transaction: existing, matched: existing?.status === "matched" };
  }
  const invoiceId = await findInvoiceFor(workspaceId, input.accountRef, input.amount);
  if (invoiceId) await applyToInvoice(workspaceId, inserted.id, invoiceId);
  else await db.appendDashboardActivity(workspaceId, [{ recordId: inserted.id, tableName: "payments", action: "M-Pesa unmatched", detail: `M-Pesa ${inserted.transId} for KSh ${inserted.amount.toLocaleString("en-KE")}${input.accountRef ? ` (account "${input.accountRef}")` : ""} couldn't be matched to an invoice. Match it under Payments.`, actorUserId: null }]);
  const transaction = await getDb().select().from(mpesaTransactions).where(eq(mpesaTransactions.id, inserted.id)).limit(1).then((r) => r[0]);
  return { duplicate: false as const, transaction, matched: Boolean(invoiceId) };
}

/**
 * An M-Pesa code typed in on an invoice. Stored once like any other M-Pesa payment and recorded
 * against that invoice. A code that is already on record is linked to this invoice if it is still
 * unmatched, and refused if it was recorded against a different invoice.
 */
export async function recordMpesaCode(workspaceId: string, input: { invoiceId: string; code: string; amount: number; paidAt: Date }) {
  const invoice = await getDb().select().from(invoices).where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, input.invoiceId))).limit(1).then((r) => r[0]);
  if (!invoice) return "NOT_FOUND" as const;
  const transId = input.code.toUpperCase();
  const existing = await getDb().select().from(mpesaTransactions).where(and(eq(mpesaTransactions.workspaceId, workspaceId), eq(mpesaTransactions.transId, transId))).limit(1).then((r) => r[0]);
  if (existing) {
    if (existing.paymentId) return existing.invoiceId === input.invoiceId ? "ALREADY_ON_INVOICE" as const : "ALREADY_MATCHED" as const;
    return applyToInvoice(workspaceId, existing.id, input.invoiceId);
  }
  const inserted = await getDb().insert(mpesaTransactions).values({ workspaceId, transId, amount: input.amount, accountRef: invoice.number, payerName: null, payerPhone: null, paidAt: input.paidAt, source: "manual" }).onConflictDoNothing().returning().then((r) => r[0]);
  if (!inserted) return "ALREADY_MATCHED" as const;
  return applyToInvoice(workspaceId, inserted.id, input.invoiceId);
}

export async function matchMpesa(workspaceId: string, txId: string, invoiceId: string) { return applyToInvoice(workspaceId, txId, invoiceId); }

export async function ignoreMpesa(workspaceId: string, txId: string) {
  await getDb().update(mpesaTransactions).set({ status: "ignored" }).where(and(eq(mpesaTransactions.workspaceId, workspaceId), eq(mpesaTransactions.id, txId), eq(mpesaTransactions.status, "unmatched")));
}
