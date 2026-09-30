import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import * as db from "./db.js";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); const derived = await scrypt(password, salt, 64) as Buffer; return `scrypt$${salt}$${derived.toString("hex")}`; }
export async function verifyPassword(password: string, stored: string) { const [scheme, salt, hash] = stored.split("$"); if (scheme !== "scrypt" || !salt || !hash) return false; const derived = await scrypt(password, salt, 64) as Buffer; const expected = Buffer.from(hash, "hex"); return expected.length === derived.length && timingSafeEqual(expected, derived); }
export function hashSession(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function issueSession(userId: string, workspaceId: string) { const token = randomBytes(48).toString("base64url"); await db.createSession(userId, workspaceId, hashSession(token), new Date(Date.now() + 30 * 86400000)); return token; }
