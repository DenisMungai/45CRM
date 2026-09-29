import { asc, desc, eq, and, inArray } from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { activityEvents, clients, leads, projects, quotes, invoices, payments, inventoryItems, transactions, users, workspaceInvitations, workspaceMembers, workspaces, sessions } from "../drizzle/schema";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10), ssl: process.env.DATABASE_SSL === "false" ? false : process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
    db = drizzle(pool);
  }
  return db;
}

export async function closeDb() { if (pool) await pool.end(); pool = null; db = null; }

export async function findUserByEmail(email: string) {
  return getDb().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1).then(r => r[0]);
}
export async function findUserById(id: string) { return getDb().select().from(users).where(eq(users.id, id)).limit(1).then(r => r[0]); }
export async function createUser(input: typeof users.$inferInsert) { return getDb().insert(users).values({ ...input, email: input.email.toLowerCase() }).returning().then(r => r[0]); }
export async function updateUser(id: string, data: Partial<typeof users.$inferInsert>) { return getDb().update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id)).returning().then(r => r[0]); }

export async function createWorkspace(name: string, slug: string, ownerId: string) {
  const workspace = await getDb().insert(workspaces).values({ name, slug }).returning().then(r => r[0]);
  await getDb().insert(workspaceMembers).values({ workspaceId: workspace.id, userId: ownerId, role: "owner", status: "active" });
  return workspace;
}
export async function getMembership(userId: string, workspaceId: string) { return getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active"))).limit(1).then(r => r[0]); }
export async function getWorkspace(workspaceId: string) { return getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then(r => r[0]); }
export async function updateWorkspaceProfile(workspaceId: string, data: Partial<Pick<typeof workspaces.$inferInsert, "name" | "currency" | "businessEmail" | "businessPhone" | "businessAddress">>) {
  return getDb().update(workspaces).set({ ...data, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId)).returning().then(r => r[0]);
}
export async function ensureLeadWebhookSecret(workspaceId: string) {
  const existing = await getDb().select({ secret: workspaces.leadWebhookSecret }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1).then(r => r[0]);
  if (existing?.secret) return existing.secret;
  const secret = randomBytes(24).toString("hex");
  await getDb().update(workspaces).set({ leadWebhookSecret: secret, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
  return secret;
}
export async function findWorkspaceByWebhookSecret(secret: string) {
  return getDb().select().from(workspaces).where(eq(workspaces.leadWebhookSecret, secret)).limit(1).then(r => r[0]);
}
export async function listUserWorkspaces(userId: string) { return getDb().select({ workspace: workspaces, membership: workspaceMembers }).from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId)).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active"))).orderBy(asc(workspaces.name)); }
export async function countWorkspaceAdmins(workspaceId: string) { return getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.role, ["owner", "admin"]), eq(workspaceMembers.status, "active"))).then(r => r.length); }

export async function createSession(userId: string, workspaceId: string, tokenHash: string, expiresAt: Date) { return getDb().insert((await import("../drizzle/schema")).sessions).values({ userId, workspaceId, tokenHash, expiresAt }).returning().then(r => r[0]); }
export async function findSession(tokenHash: string) { return getDb().select({ session: sessions, user: users, membership: workspaceMembers, workspace: workspaces }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, sessions.workspaceId))).innerJoin(workspaces, eq(workspaces.id, sessions.workspaceId)).where(and(eq(sessions.tokenHash, tokenHash), eq(workspaceMembers.status, "active"))).limit(1).then(r => r[0]); }
export async function deleteSession(tokenHash: string) { await getDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash)); }
export async function touchSession(id: string) { await getDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id)); }

export async function appendDashboardActivity(workspaceId: string, events: { id?: string; recordId: string; tableName: string; action: string; detail: string; actorUserId: string | null }[]) {
  if (!events.length) return;
  // onConflictDoNothing makes this idempotent by id. Some browsers still have activity events in
  // local storage that were seeded from this same table's own rows (real server-assigned ids) by
  // an older client build that didn't mark them as already-synced - those get resent forever
  // otherwise, and since a multi-row INSERT fails entirely on a single colliding id, every *other*
  // (legitimate, new) event bundled in the same batch was failing right along with it. Skipping
  // duplicates instead lets the rest of the batch through and lets the client's onSuccess handler
  // mark everything - including the stale duplicate - as synced, so it stops retrying for good.
  await getDb().insert(activityEvents).values(events.map(e => ({ id: e.id && /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : randomUUID(), workspaceId, entityType: e.tableName, entityId: e.recordId, action: e.action, detail: e.detail, actorUserId: e.actorUserId }))).onConflictDoNothing({ target: activityEvents.id });
}
export async function listDashboardActivity(workspaceId: string, recordId?: string) {
  const conditions = recordId ? and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.entityId, recordId)) : eq(activityEvents.workspaceId, workspaceId);
  return getDb().select({ id: activityEvents.id, recordId: activityEvents.entityId, tableName: activityEvents.entityType, action: activityEvents.action, detail: activityEvents.detail, actorUserId: activityEvents.actorUserId, createdAt: activityEvents.createdAt, actorName: users.name, actorEmail: users.email }).from(activityEvents).leftJoin(users, eq(activityEvents.actorUserId, users.id)).where(conditions).orderBy(desc(activityEvents.createdAt));
}

export async function listWorkspaceUsers(workspaceId: string) {
  return getDb().select({ id: users.id, name: users.name, email: users.email, role: workspaceMembers.role, status: workspaceMembers.status, createdAt: users.createdAt, updatedAt: users.updatedAt, lastSignedIn: users.lastSignedIn }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId)).orderBy(asc(users.name));
}
export async function setWorkspaceUserRole(workspaceId: string, userId: string, role: "admin" | "member") { await getDb().update(workspaceMembers).set({ role, updatedAt: new Date() }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))); }
export async function deleteWorkspaceUser(workspaceId: string, userId: string) { const database = getDb(); await database.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))); const remaining = await database.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId)); if (!remaining.length) await database.delete(users).where(eq(users.id, userId)); }
export async function updateWorkspaceUserProfile(userId: string, name: string) { return updateUser(userId, { name }); }

export async function createWorkspaceInvitation(invitation: typeof workspaceInvitations.$inferInsert) { return getDb().insert(workspaceInvitations).values(invitation).returning().then(r => r[0]); }
export async function updateWorkspaceInvitationDelivery(id: string, status: "accepted" | "expired" | "revoked" | "pending", detail?: string) { await getDb().update(workspaceInvitations).set({ status }).where(eq(workspaceInvitations.id, id)); return detail; }
export async function listWorkspaceInvitations(workspaceId: string) { return getDb().select().from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, workspaceId)).orderBy(desc(workspaceInvitations.createdAt)); }

export async function getWorkspaceDashboardData(workspaceId: string) {
  const [clientRows, leadRows, projectRows, invoiceRows, paymentRows, transactionRows] = await Promise.all([
    getDb().select().from(clients).where(eq(clients.workspaceId, workspaceId)),
    getDb().select().from(leads).where(eq(leads.workspaceId, workspaceId)),
    getDb().select().from(projects).where(eq(projects.workspaceId, workspaceId)),
    getDb().select().from(invoices).where(eq(invoices.workspaceId, workspaceId)),
    getDb().select().from(payments).where(eq(payments.workspaceId, workspaceId)),
    getDb().select().from(transactions).where(eq(transactions.workspaceId, workspaceId)),
  ]);
  return { clients: clientRows, leads: leadRows, projects: projectRows, invoices: invoiceRows, payments: paymentRows, transactions: transactionRows };
}
