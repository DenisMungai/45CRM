import { and, desc, eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb } from "./db.js";
import { clientAssets, clients } from "../drizzle/schema.js";
import { ENV } from "./_core/env.js";

/** Largest file kept in the vault (also under Vercel's request-body limit). */
export const VAULT_MAX_BYTES = 4 * 1024 * 1024;

// AES-256-GCM with a key derived from the session secret. Rotating SESSION_SECRET makes stored
// secrets unreadable, so re-enter logins after rotating it.
const key = () => createHash("sha256").update(`client-vault:${ENV.sessionSecret}`).digest();
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Everything but the file bytes and the encrypted secret. */
const listColumns = { id: clientAssets.id, clientId: clientAssets.clientId, projectId: clientAssets.projectId, kind: clientAssets.kind, name: clientAssets.name, url: clientAssets.url, username: clientAssets.username, notes: clientAssets.notes, mimeType: clientAssets.mimeType, sizeBytes: clientAssets.sizeBytes, visibility: clientAssets.visibility, source: clientAssets.source, createdAt: clientAssets.createdAt, hasSecret: clientAssets.secretEncrypted };

export async function clientInWorkspace(workspaceId: string, clientId: string) {
  return getDb().select().from(clients).where(and(eq(clients.workspaceId, workspaceId), eq(clients.id, clientId))).limit(1).then((r) => r[0]);
}

export async function listAssets(workspaceId: string, clientId: string, clientVisibleOnly = false) {
  const rows = await getDb().select(listColumns).from(clientAssets).where(and(eq(clientAssets.workspaceId, workspaceId), eq(clientAssets.clientId, clientId), ...(clientVisibleOnly ? [eq(clientAssets.visibility, "client")] : []))).orderBy(desc(clientAssets.createdAt));
  return rows.map((row) => ({ ...row, hasSecret: Boolean(row.hasSecret) }));
}

export async function getAsset(workspaceId: string, id: string) {
  return getDb().select().from(clientAssets).where(and(eq(clientAssets.workspaceId, workspaceId), eq(clientAssets.id, id))).limit(1).then((r) => r[0]);
}

export async function addFile(workspaceId: string, input: { clientId: string; projectId?: string | null; name: string; mimeType: string; content: Buffer; visibility: "internal" | "client"; notes?: string | null; source: "team" | "client"; userId: string | null }) {
  return getDb().insert(clientAssets).values({ workspaceId, clientId: input.clientId, projectId: input.projectId ?? null, kind: "file", name: input.name.slice(0, 200), mimeType: input.mimeType.slice(0, 120), sizeBytes: input.content.length, content: input.content, visibility: input.visibility, notes: input.notes ?? null, source: input.source, uploadedByUserId: input.userId }).returning({ id: clientAssets.id, name: clientAssets.name }).then((r) => r[0]);
}

export async function addLinkOrCredential(workspaceId: string, userId: string, input: { clientId: string; kind: "link" | "credential"; name: string; url?: string | null; username?: string | null; secret?: string | null; notes?: string | null; visibility: "internal" | "client" }) {
  return getDb().insert(clientAssets).values({
    workspaceId, clientId: input.clientId, kind: input.kind, name: input.name.trim(), url: input.url?.trim() || null, username: input.username?.trim() || null,
    secretEncrypted: input.kind === "credential" && input.secret ? encryptSecret(input.secret) : null,
    notes: input.notes?.trim() || null,
    // Logins are never shown in the client portal.
    visibility: input.kind === "credential" ? "internal" : input.visibility,
    source: "team", uploadedByUserId: userId,
  }).returning({ id: clientAssets.id, name: clientAssets.name }).then((r) => r[0]);
}

export async function updateAsset(workspaceId: string, id: string, input: { name?: string; url?: string | null; username?: string | null; secret?: string | null; notes?: string | null; visibility?: "internal" | "client" }) {
  const asset = await getAsset(workspaceId, id);
  if (!asset) return undefined;
  return getDb().update(clientAssets).set({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.url !== undefined ? { url: input.url?.trim() || null } : {}),
    ...(input.username !== undefined ? { username: input.username?.trim() || null } : {}),
    // An empty secret keeps the stored one; send a new value to replace it.
    ...(input.secret ? { secretEncrypted: encryptSecret(input.secret) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...(input.visibility !== undefined ? { visibility: asset.kind === "credential" ? "internal" : input.visibility } : {}),
    updatedAt: new Date(),
  }).where(eq(clientAssets.id, id)).returning({ id: clientAssets.id }).then((r) => r[0]);
}

export async function deleteAsset(workspaceId: string, id: string) {
  await getDb().delete(clientAssets).where(and(eq(clientAssets.workspaceId, workspaceId), eq(clientAssets.id, id)));
}

export async function revealSecret(workspaceId: string, id: string) {
  const asset = await getAsset(workspaceId, id);
  if (!asset || asset.kind !== "credential" || !asset.secretEncrypted) return undefined;
  return { asset, secret: decryptSecret(asset.secretEncrypted) };
}

/** Content-Disposition with a safe ASCII fallback and the real (UTF-8) name. */
export function contentDisposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
