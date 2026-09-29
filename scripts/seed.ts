import "dotenv/config";
import { hashPassword } from "../server/auth";
import * as db from "../server/db";

const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@45creatives.local").toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "ChangeMe123!";
const existing = await db.findUserByEmail(email);
if (existing) { console.log(`Admin already exists: ${email}`); process.exit(0); }
const user = await db.createUser({ email, passwordHash: await hashPassword(password), name: "45Creatives Admin" });
const workspace = await db.createWorkspace("45Creatives", "45creatives", user.id);
console.log(`Created workspace ${workspace.name}`);
console.log(`Admin: ${email}`);
console.log(`Password: ${password}`);
