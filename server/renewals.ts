import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { clients, contracts, renewals } from "../drizzle/schema.js";
import { createInvoiceWithDocument, latestPaymentInstructions } from "./invoiceDocs.js";
import { defaultInvoiceFields, type InvoiceFields } from "../shared/invoice.js";
import { advanceDueDate, isRenewalCycle, RENEWAL_TYPE_LABELS, renewalPeriodLabel, type RenewalCycle, type RenewalType } from "../shared/renewal.js";
import type { ContractFields } from "../shared/contract.js";

export type RenewalInput = {
  id?: string; clientName: string; type: RenewalType; name: string; provider?: string | null;
  cycle: RenewalCycle; amount: number; cost: number; nextDueDate: Date; status: "active" | "cancelled"; notes?: string | null;
};

async function clientIdByName(workspaceId: string, name: string) {
  return getDb().select({ id: clients.id }).from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.name, name.trim()))).limit(1).then((r) => r[0]?.id ?? null);
}

export async function listRenewals(workspaceId: string) {
  return getDb().select().from(renewals).where(eq(renewals.workspaceId, workspaceId)).orderBy(asc(renewals.nextDueDate));
}

export async function getRenewal(workspaceId: string, id: string) {
  return getDb().select().from(renewals).where(and(eq(renewals.workspaceId, workspaceId), eq(renewals.id, id))).limit(1).then((r) => r[0]);
}

export async function upsertRenewal(workspaceId: string, input: RenewalInput) {
  const values = {
    clientName: input.clientName.trim(), clientId: await clientIdByName(workspaceId, input.clientName), type: input.type, name: input.name.trim(),
    provider: input.provider?.trim() || null, cycle: input.cycle, amount: input.amount, cost: input.cost, nextDueDate: input.nextDueDate,
    status: input.status, notes: input.notes?.trim() || null, updatedAt: new Date(),
  };
  if (input.id) return getDb().update(renewals).set(values).where(and(eq(renewals.workspaceId, workspaceId), eq(renewals.id, input.id))).returning().then((r) => r[0]);
  return getDb().insert(renewals).values({ workspaceId, ...values }).returning().then((r) => r[0]);
}

export async function deleteRenewal(workspaceId: string, id: string) {
  await getDb().delete(renewals).where(and(eq(renewals.workspaceId, workspaceId), eq(renewals.id, id)));
}

/**
 * Bills the coming period: creates a draft invoice for the renewal (due on the renewal date, or
 * today when it is already overdue) and moves the renewal on by one cycle. The invoice is a normal
 * draft, so it can be reviewed, edited and sent from Invoices like any other.
 */
export async function invoiceRenewal(workspaceId: string, userId: string, id: string) {
  const renewal = await getRenewal(workspaceId, id);
  if (!renewal) return { error: "NOT_FOUND" as const };
  if (renewal.status !== "active") return { error: "CANCELLED" as const };
  if (renewal.amount <= 0) return { error: "NO_AMOUNT" as const };
  const cycle = isRenewalCycle(renewal.cycle) ? renewal.cycle : "yearly";
  const typeLabel = RENEWAL_TYPE_LABELS[renewal.type as RenewalType] || "Service";
  const client = renewal.clientId ? await getDb().select().from(clients).where(eq(clients.id, renewal.clientId)).limit(1).then((r) => r[0]) : undefined;
  const period = renewalPeriodLabel(renewal.nextDueDate, cycle);
  const fields: InvoiceFields = {
    ...defaultInvoiceFields,
    ...(await latestPaymentInstructions(workspaceId)),
    clientName: renewal.clientName,
    contactPerson: client?.contactName || "",
    clientEmail: client?.email || "",
    clientPhone: client?.phone || "",
    projectName: renewal.name,
    scope: `${typeLabel} renewal`,
    quotationRef: "",
    paymentTerms: "Payable before the renewal date to avoid interruption",
    milestone: "Renewal",
    items: [{ description: `${typeLabel} renewal - ${renewal.name} (${period})`, quantity: 1, unitPrice: renewal.amount }],
    discount: 0,
    notes: renewal.provider ? `Provider: ${renewal.provider}` : "",
  };
  const today = new Date();
  const issueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dueDate = renewal.nextDueDate > issueDate ? renewal.nextDueDate : issueDate;
  const invoice = await createInvoiceWithDocument(workspaceId, userId, { fields, issueDate, dueDate });
  const nextDueDate = advanceDueDate(renewal.nextDueDate, cycle);
  await getDb().update(renewals).set({ lastInvoiceId: invoice.id, lastInvoicedAt: new Date(), nextDueDate, updatedAt: new Date() }).where(eq(renewals.id, renewal.id));
  return { invoice, nextDueDate, renewal };
}

/**
 * Turns a contract's hosting / domain / maintenance terms into renewals: annual hosting at the
 * agreed price, the domain yearly, and the monthly maintenance retainer. Skips any already created
 * from the same contract, so pressing it twice is harmless.
 */
export async function createRenewalsFromContract(workspaceId: string, contractId: string) {
  const contract = await getDb().select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.id, contractId))).limit(1).then((r) => r[0]);
  if (!contract) return { error: "NOT_FOUND" as const };
  const f = contract.fields as ContractFields;
  const existing = await getDb().select({ type: renewals.type }).from(renewals).where(and(eq(renewals.workspaceId, workspaceId), eq(renewals.contractId, contractId)));
  const has = new Set(existing.map((r) => r.type));
  const start = new Date();
  const yearOut = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  const monthOut = advanceDueDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())), "monthly");
  const site = f.domainName || f.projectName || contract.title;
  const planned: { type: RenewalType; name: string; provider: string | null; cycle: RenewalCycle; amount: number; nextDueDate: Date }[] = [];
  if (f.hostingIncluded || f.hostingCost > 0) planned.push({ type: "hosting", name: `${site} hosting`, provider: f.hostingPlatform || null, cycle: "yearly", amount: f.hostingCost || 0, nextDueDate: yearOut });
  if (f.domainIncluded && f.domainName) planned.push({ type: "domain", name: f.domainName, provider: null, cycle: "yearly", amount: 0, nextDueDate: yearOut });
  if (f.maintenanceFee > 0) planned.push({ type: "maintenance", name: `${site} maintenance`, provider: null, cycle: "monthly", amount: f.maintenanceFee, nextDueDate: monthOut });
  const toCreate = planned.filter((p) => !has.has(p.type));
  if (!toCreate.length) return { created: [], skipped: planned.length };
  const clientId = contract.clientId ?? (await clientIdByName(workspaceId, contract.clientName));
  const created = await getDb().insert(renewals).values(toCreate.map((p) => ({ workspaceId, clientId, contractId, clientName: contract.clientName, status: "active", cost: 0, ...p }))).returning();
  return { created, skipped: planned.length - toCreate.length };
}
