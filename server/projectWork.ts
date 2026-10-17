import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./db.js";
import { changeRequests, clients, contracts, projectMilestones, projects, projectTasks, timeEntries, users, workspaces } from "../drizzle/schema.js";
import { createInvoiceWithDocument, latestPaymentInstructions } from "./invoiceDocs.js";
import { defaultInvoiceFields, type InvoiceFields, type InvoiceLineItem } from "../shared/invoice.js";
import type { ContractFields } from "../shared/contract.js";

export const MILESTONE_STATUSES = ["pending", "in-progress", "awaiting-approval", "approved", "changes-requested"] as const;
export const CHANGE_STATUSES = ["requested", "approved", "declined", "done"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export async function getProject(workspaceId: string, projectId: string) {
  return getDb().select().from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId))).limit(1).then((r) => r[0]);
}

/** The agreement covering a project: one linked to it, else the client's latest signed one. */
async function projectContract(workspaceId: string, project: typeof projects.$inferSelect) {
  const linked = await getDb().select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.projectId, project.id))).orderBy(desc(contracts.createdAt)).limit(1).then((r) => r[0]);
  if (linked) return linked;
  if (!project.clientId) return undefined;
  return getDb().select().from(contracts).where(and(eq(contracts.workspaceId, workspaceId), eq(contracts.clientId, project.clientId), eq(contracts.status, "signed"))).orderBy(desc(contracts.createdAt)).limit(1).then((r) => r[0]);
}

/** Revision requests are numbered in order; those past the contract's included rounds are billable. */
export function numberRevisions<T extends { id: string; kind: string; status: string; createdAt: Date }>(requests: T[], includedRounds: number) {
  let count = 0;
  const numbers = new Map<string, { revisionNumber: number; overLimit: boolean }>();
  for (const request of [...requests].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (request.kind !== "revision" || request.status === "declined") continue;
    count += 1;
    numbers.set(request.id, { revisionNumber: count, overLimit: count > includedRounds });
  }
  return numbers;
}

/** Project progress follows its milestones: the share already approved by the client. */
export async function recomputeProgress(workspaceId: string, projectId: string) {
  const rows = await getDb().select({ status: projectMilestones.status }).from(projectMilestones).where(and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId)));
  if (!rows.length) return;
  const progress = Math.round((rows.filter((r) => r.status === "approved").length / rows.length) * 100);
  await getDb().update(projects).set({ progress, updatedAt: new Date() }).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
}

export async function projectWorkspace(workspaceId: string, projectId: string) {
  const project = await getProject(workspaceId, projectId);
  if (!project) return undefined;
  const db = getDb();
  const [client, contract, milestones, tasks, changes, time, workspace] = await Promise.all([
    project.clientId ? db.select().from(clients).where(eq(clients.id, project.clientId)).limit(1).then((r) => r[0]) : Promise.resolve(undefined),
    projectContract(workspaceId, project),
    db.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId)).orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.createdAt)),
    db.select({ task: projectTasks, assigneeName: users.name }).from(projectTasks).leftJoin(users, eq(users.id, projectTasks.assigneeUserId)).where(eq(projectTasks.projectId, projectId)).orderBy(asc(projectTasks.createdAt)),
    db.select().from(changeRequests).where(eq(changeRequests.projectId, projectId)).orderBy(desc(changeRequests.createdAt)),
    db.select({ entry: timeEntries, userName: users.name }).from(timeEntries).leftJoin(users, eq(users.id, timeEntries.userId)).where(eq(timeEntries.projectId, projectId)).orderBy(desc(timeEntries.workDate), desc(timeEntries.createdAt)),
    db.select({ defaultHourlyRate: workspaces.defaultHourlyRate }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then((r) => r[0]),
  ]);
  const fields = contract?.fields as ContractFields | undefined;
  const includedRounds = fields?.revisionRounds ?? 0;
  const revisionNumbers = numberRevisions(changes, includedRounds);
  const unbilled = time.filter((t) => t.entry.billable && !t.entry.invoiceId);
  return {
    project: { id: project.id, name: project.name, status: project.status, progress: project.progress, dueDate: project.dueDate, budget: project.budget },
    client: client ? { id: client.id, name: client.name, email: client.email, phone: client.phone } : null,
    contract: contract ? { id: contract.id, title: contract.title, status: contract.status, revisionRounds: includedRounds, extraRevisionCost: fields?.extraRevisionCost ?? 0 } : null,
    milestones,
    tasks: tasks.map((t) => ({ ...t.task, assigneeName: t.assigneeName })),
    changeRequests: changes.map((c) => ({ ...c, ...(revisionNumbers.get(c.id) || { revisionNumber: null, overLimit: false }) })),
    timeEntries: time.map((t) => ({ ...t.entry, userName: t.userName })),
    totals: {
      minutes: time.reduce((sum, t) => sum + t.entry.minutes, 0),
      unbilledMinutes: unbilled.reduce((sum, t) => sum + t.entry.minutes, 0),
      unbilledAmount: Math.round(unbilled.reduce((sum, t) => sum + (t.entry.minutes / 60) * t.entry.hourlyRate, 0)),
    },
    defaultHourlyRate: workspace?.defaultHourlyRate ?? 0,
  };
}

// --- Milestones ---------------------------------------------------------------------------------

export async function upsertMilestone(workspaceId: string, input: { id?: string; projectId: string; title: string; description?: string | null; dueDate?: Date | null; amount: number; status: MilestoneStatus }) {
  const values = { title: input.title.trim(), description: input.description?.trim() || null, dueDate: input.dueDate ?? null, amount: input.amount, status: input.status, updatedAt: new Date() };
  const saved = input.id
    ? await getDb().update(projectMilestones).set(values).where(and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.id, input.id))).returning().then((r) => r[0])
    : await getDb().insert(projectMilestones).values({ workspaceId, projectId: input.projectId, sortOrder: Date.now() % 1_000_000_000, ...values }).returning().then((r) => r[0]);
  if (saved) await recomputeProgress(workspaceId, saved.projectId);
  return saved;
}

export async function getMilestone(workspaceId: string, id: string) {
  return getDb().select().from(projectMilestones).where(and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.id, id))).limit(1).then((r) => r[0]);
}

export async function deleteMilestone(workspaceId: string, id: string) {
  const milestone = await getMilestone(workspaceId, id);
  if (!milestone) return;
  await getDb().delete(projectMilestones).where(eq(projectMilestones.id, id));
  await recomputeProgress(workspaceId, milestone.projectId);
}

/** The client's answer from the portal. Only a milestone waiting for approval can be decided. */
export async function decideMilestone(workspaceId: string, id: string, decision: "approved" | "changes-requested", name: string, note: string | null) {
  const milestone = await getMilestone(workspaceId, id);
  if (!milestone) return "NOT_FOUND" as const;
  if (milestone.status !== "awaiting-approval") return "NOT_AWAITING" as const;
  await getDb().update(projectMilestones).set({ status: decision, decidedByName: name, clientNote: note, decidedAt: new Date(), updatedAt: new Date() }).where(eq(projectMilestones.id, id));
  if (decision === "changes-requested") await getDb().insert(changeRequests).values({ workspaceId, projectId: milestone.projectId, title: `Changes to "${milestone.title}"`, description: note, kind: "revision", source: "client", requestedByName: name, status: "requested" });
  await recomputeProgress(workspaceId, milestone.projectId);
  return null;
}

// --- Tasks --------------------------------------------------------------------------------------

export async function upsertTask(workspaceId: string, input: { id?: string; projectId: string; milestoneId?: string | null; title: string; assigneeUserId?: string | null; dueDate?: Date | null; done: boolean; priority: string }) {
  const values = { title: input.title.trim(), milestoneId: input.milestoneId ?? null, assigneeUserId: input.assigneeUserId ?? null, dueDate: input.dueDate ?? null, status: input.done ? "done" : "todo", completedAt: input.done ? new Date() : null, priority: input.priority, updatedAt: new Date() };
  if (input.id) {
    const existing = await getDb().select().from(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.id, input.id))).limit(1).then((r) => r[0]);
    if (!existing) return undefined;
    // Keep the original completion time when a done task is edited.
    return getDb().update(projectTasks).set({ ...values, completedAt: input.done ? existing.completedAt ?? new Date() : null }).where(eq(projectTasks.id, input.id)).returning().then((r) => r[0]);
  }
  return getDb().insert(projectTasks).values({ workspaceId, projectId: input.projectId, ...values }).returning().then((r) => r[0]);
}

export async function deleteTask(workspaceId: string, id: string) {
  await getDb().delete(projectTasks).where(and(eq(projectTasks.workspaceId, workspaceId), eq(projectTasks.id, id)));
}

// --- Change requests ----------------------------------------------------------------------------

export async function upsertChangeRequest(workspaceId: string, input: { id?: string; projectId: string; title: string; description?: string | null; kind: "revision" | "change"; status: (typeof CHANGE_STATUSES)[number]; estimateHours: number; amount: number; source?: "internal" | "client"; requestedByName?: string | null }) {
  const values = { title: input.title.trim(), description: input.description?.trim() || null, kind: input.kind, status: input.status, estimateHours: input.estimateHours, amount: input.amount, updatedAt: new Date() };
  if (input.id) return getDb().update(changeRequests).set(values).where(and(eq(changeRequests.workspaceId, workspaceId), eq(changeRequests.id, input.id))).returning().then((r) => r[0]);
  const created = await getDb().insert(changeRequests).values({ workspaceId, projectId: input.projectId, source: input.source ?? "internal", requestedByName: input.requestedByName ?? null, ...values }).returning().then((r) => r[0]);
  // A revision past the contract's included rounds is priced at its extra-revision rate by default.
  if (created.kind === "revision" && !created.amount) {
    const workspaceView = await projectWorkspace(workspaceId, created.projectId);
    const numbered = workspaceView?.changeRequests.find((c) => c.id === created.id);
    if (numbered?.overLimit && workspaceView?.contract?.extraRevisionCost) return getDb().update(changeRequests).set({ amount: workspaceView.contract.extraRevisionCost }).where(eq(changeRequests.id, created.id)).returning().then((r) => r[0]);
  }
  return created;
}

export async function deleteChangeRequest(workspaceId: string, id: string) {
  await getDb().delete(changeRequests).where(and(eq(changeRequests.workspaceId, workspaceId), eq(changeRequests.id, id)));
}

// --- Time ---------------------------------------------------------------------------------------

export async function addTimeEntry(workspaceId: string, userId: string, input: { projectId: string; changeRequestId?: string | null; description: string; minutes: number; workDate: Date; billable: boolean; hourlyRate: number }) {
  return getDb().insert(timeEntries).values({ workspaceId, userId, projectId: input.projectId, changeRequestId: input.changeRequestId ?? null, description: input.description.trim(), minutes: input.minutes, workDate: input.workDate, billable: input.billable, hourlyRate: input.hourlyRate }).returning().then((r) => r[0]);
}

export async function deleteTimeEntry(workspaceId: string, id: string) {
  const entry = await getDb().select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.id, id))).limit(1).then((r) => r[0]);
  if (!entry) return "NOT_FOUND" as const;
  if (entry.invoiceId) return "INVOICED" as const;
  await getDb().delete(timeEntries).where(eq(timeEntries.id, id));
  return null;
}

// --- Invoicing ----------------------------------------------------------------------------------

async function draftInvoiceFor(workspaceId: string, userId: string, projectId: string, items: InvoiceLineItem[], extra: Partial<InvoiceFields>) {
  const view = await projectWorkspace(workspaceId, projectId);
  if (!view) throw new Error("Project not found.");
  if (!view.client) return { error: "NO_CLIENT" as const };
  const fields: InvoiceFields = {
    ...defaultInvoiceFields,
    ...(await latestPaymentInstructions(workspaceId)),
    clientName: view.client.name,
    clientEmail: view.client.email || "",
    clientPhone: view.client.phone || "",
    projectName: view.project.name,
    quotationRef: view.contract?.title.slice(0, 120) || "",
    items,
    ...extra,
  };
  const today = new Date();
  const issueDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const invoice = await createInvoiceWithDocument(workspaceId, userId, { fields, issueDate, dueDate: new Date(issueDate.getTime() + 14 * 86_400_000) });
  return { invoice };
}

export async function invoiceMilestone(workspaceId: string, userId: string, id: string) {
  const milestone = await getMilestone(workspaceId, id);
  if (!milestone) return { error: "NOT_FOUND" as const };
  if (milestone.invoiceId) return { error: "ALREADY_INVOICED" as const };
  if (milestone.amount <= 0) return { error: "NO_AMOUNT" as const };
  const result = await draftInvoiceFor(workspaceId, userId, milestone.projectId, [{ description: `Milestone: ${milestone.title}`, quantity: 1, unitPrice: milestone.amount }], { milestone: milestone.title.slice(0, 120) });
  if (result.error) return { error: result.error };
  await getDb().update(projectMilestones).set({ invoiceId: result.invoice.id, updatedAt: new Date() }).where(eq(projectMilestones.id, id));
  return result;
}

/** Bills approved or done change requests that have a price and haven't been invoiced. */
export async function invoiceChangeRequests(workspaceId: string, userId: string, projectId: string) {
  const view = await projectWorkspace(workspaceId, projectId);
  if (!view) return { error: "NOT_FOUND" as const };
  const billable = view.changeRequests.filter((c) => !c.invoiceId && c.amount > 0 && (c.status === "approved" || c.status === "done"));
  if (!billable.length) return { error: "NOTHING_TO_BILL" as const };
  const items = billable.map((c) => ({ description: c.kind === "revision" && c.revisionNumber ? `Revision round ${c.revisionNumber}${view.contract ? ` (beyond the ${view.contract.revisionRounds} included)` : ""}: ${c.title}` : `Change request: ${c.title}`, quantity: 1, unitPrice: c.amount }));
  const result = await draftInvoiceFor(workspaceId, userId, projectId, items, { milestone: "Change requests", scope: "Additional work outside the agreed scope" });
  if (result.error) return { error: result.error };
  await getDb().update(changeRequests).set({ invoiceId: result.invoice.id, updatedAt: new Date() }).where(inArray(changeRequests.id, billable.map((c) => c.id)));
  return { ...result, count: billable.length };
}

/** Bills every unbilled billable time entry, one line per hourly rate. */
export async function invoiceTime(workspaceId: string, userId: string, projectId: string) {
  const entries = await getDb().select().from(timeEntries).where(and(eq(timeEntries.workspaceId, workspaceId), eq(timeEntries.projectId, projectId), eq(timeEntries.billable, true), isNull(timeEntries.invoiceId)));
  const priced = entries.filter((e) => e.hourlyRate > 0 && e.minutes > 0);
  if (!priced.length) return { error: "NOTHING_TO_BILL" as const };
  const byRate = new Map<number, number>();
  for (const e of priced) byRate.set(e.hourlyRate, (byRate.get(e.hourlyRate) || 0) + e.minutes);
  const items = Array.from(byRate, ([rate, minutes]) => ({ description: `Development time (${(minutes / 60).toFixed(2)} h at KSh ${rate.toLocaleString("en-KE")}/h)`, quantity: Math.round((minutes / 60) * 100) / 100, unitPrice: rate }));
  const result = await draftInvoiceFor(workspaceId, userId, projectId, items, { milestone: "Time & materials" });
  if (result.error) return { error: result.error };
  await getDb().update(timeEntries).set({ invoiceId: result.invoice.id }).where(inArray(timeEntries.id, priced.map((e) => e.id)));
  return { ...result, count: priced.length };
}
