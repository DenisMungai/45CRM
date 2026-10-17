import express, { type Express, type Request, type Response } from "express";
import { createContext } from "./_core/trpc.js";
import * as db from "./db.js";
import { runPaymentReminders } from "./reminders.js";
import { receiveMpesa, workspaceForMpesaSecret } from "./mpesa.js";
import { addFile, clientInWorkspace, contentDisposition, getAsset, VAULT_MAX_BYTES } from "./vault.js";
import { clientForPortalToken } from "./portal.js";
import { parseDarajaTime } from "../shared/mpesa.js";

const rawUpload = express.raw({ type: () => true, limit: VAULT_MAX_BYTES });

function sendAsset(res: Response, asset: { name: string; mimeType: string | null; content: Buffer | null }, download: boolean) {
  if (!asset.content) return res.status(404).json({ error: "File not found." });
  const type = asset.mimeType || "application/octet-stream";
  // Only images and PDFs open in the browser; anything else (e.g. HTML or SVG) is always downloaded.
  const inline = !download && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(type);
  res.setHeader("Content-Type", inline ? type : "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(asset.name, inline));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(asset.content);
}

function uploadMeta(req: Request) {
  const name = String(req.query.name || req.get("x-file-name") || "").trim().slice(0, 200);
  // Uploads are sent as application/octet-stream (so the global JSON parser never touches them);
  // the real type travels in X-File-Type.
  const mimeType = String(req.get("x-file-type") || req.get("content-type") || "application/octet-stream").split(";")[0].trim().slice(0, 120) || "application/octet-stream";
  return { name: decodeURIComponent(name), mimeType };
}

const uploadRate = new Map<string, { count: number; resetAt: number }>();
function allowUpload(key: string, max: number) {
  const now = Date.now();
  const current = uploadRate.get(key);
  if (!current || current.resetAt < now) { uploadRate.set(key, { count: 1, resetAt: now + 3_600_000 }); return true; }
  if (current.count >= max) return false;
  current.count++;
  return true;
}

/** Routes shared by the Node server (server/index.ts) and the Vercel function (api/index.ts). */
export function registerExtraRoutes(app: Express) {
  // Daily payment reminders. On Vercel, Cron calls this with "Authorization: Bearer $CRON_SECRET".
  app.get("/api/cron/reminders", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: "Set CRON_SECRET to enable scheduled reminders." });
    if (req.get("authorization") !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
    try { res.json(await runPaymentReminders()); } catch (error) { console.error("Reminder run failed:", error); res.status(500).json({ error: "Reminder run failed." }); }
  });

  // M-Pesa Daraja C2B. Register these URLs (shown under Settings -> Integrations) for your paybill/till.
  app.post("/api/mpesa/c2b/:workspaceId/:secret/validation", async (req, res) => {
    const workspaceId = await workspaceForMpesaSecret(req.params.workspaceId, req.params.secret).catch(() => null);
    res.json(workspaceId ? { ResultCode: 0, ResultDesc: "Accepted" } : { ResultCode: "C2B00016", ResultDesc: "Rejected" });
  });
  app.post("/api/mpesa/c2b/:workspaceId/:secret/confirmation", async (req, res) => {
    try {
      const workspaceId = await workspaceForMpesaSecret(req.params.workspaceId, req.params.secret);
      if (!workspaceId) return res.status(401).json({ ResultCode: 1, ResultDesc: "Unknown callback" });
      const body = req.body || {};
      const transId = String(body.TransID || "").trim();
      const amount = Math.round(Number(body.TransAmount));
      if (!transId || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ResultCode: 1, ResultDesc: "Missing TransID or TransAmount" });
      await receiveMpesa(workspaceId, {
        transId, amount,
        accountRef: String(body.BillRefNumber || "").trim() || null,
        payerName: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(" ").trim() || null,
        payerPhone: String(body.MSISDN || "").trim() || null,
        paidAt: parseDarajaTime(body.TransTime) || new Date(),
        source: "daraja",
        raw: body,
      });
      res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    } catch (error) {
      console.error("M-Pesa confirmation error:", error);
      // Safaricom retries on failure; a 500 here lets it try again.
      res.status(500).json({ ResultCode: 1, ResultDesc: "Temporary error" });
    }
  });

  // Vault files for signed-in team members.
  app.post("/api/vault/upload", rawUpload, async (req, res) => {
    const { user } = await createContext({ req, res });
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    const clientId = String(req.query.clientId || "");
    const client = /^[0-9a-f-]{36}$/i.test(clientId) ? await clientInWorkspace(user.workspaceId, clientId) : undefined;
    if (!client) return res.status(404).json({ error: "Client not found." });
    const { name, mimeType } = uploadMeta(req);
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!name) return res.status(400).json({ error: "The file needs a name." });
    if (!content.length) return res.status(400).json({ error: "The file is empty." });
    const visibility = req.query.visibility === "client" ? "client" : "internal";
    const saved = await addFile(user.workspaceId, { clientId, name, mimeType, content, visibility, notes: String(req.query.notes || "").slice(0, 2000) || null, source: "team", userId: user.id });
    await db.appendDashboardActivity(user.workspaceId, [{ recordId: clientId, tableName: "clients", action: "File uploaded", detail: `${name} added to ${client.name}'s vault${visibility === "client" ? " and shared in the client portal" : ""}.`, actorUserId: user.id }]);
    res.json({ id: saved.id });
  });
  app.get("/api/vault/files/:id", async (req, res) => {
    const { user } = await createContext({ req, res });
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    const asset = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await getAsset(user.workspaceId, req.params.id) : undefined;
    if (!asset || asset.kind !== "file") return res.status(404).json({ error: "File not found." });
    sendAsset(res, asset, req.query.download === "1");
  });

  // Client portal: shared files, and content uploads from the client.
  app.get("/api/portal/:token/files/:id", async (req, res) => {
    const client = await clientForPortalToken(req.params.token);
    if (!client) return res.status(404).json({ error: "This portal link is no longer valid." });
    const asset = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await getAsset(client.workspaceId, req.params.id) : undefined;
    if (!asset || asset.kind !== "file" || asset.clientId !== client.id || asset.visibility !== "client") return res.status(404).json({ error: "File not found." });
    sendAsset(res, asset, req.query.download === "1");
  });
  app.post("/api/portal/:token/upload", rawUpload, async (req, res) => {
    const client = await clientForPortalToken(req.params.token);
    if (!client) return res.status(404).json({ error: "This portal link is no longer valid." });
    if (!allowUpload(`portal:${client.id}`, 40)) return res.status(429).json({ error: "Too many uploads. Please try again later." });
    const { name, mimeType } = uploadMeta(req);
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!name || !content.length) return res.status(400).json({ error: "Choose a file to upload." });
    const saved = await addFile(client.workspaceId, { clientId: client.id, name, mimeType, content, visibility: "client", notes: null, source: "client", userId: null });
    await db.appendDashboardActivity(client.workspaceId, [{ recordId: client.id, tableName: "clients", action: "Client upload", detail: `${client.name} uploaded ${name} through their portal.`, actorUserId: null }]);
    res.json({ id: saved.id });
  });

  // Uploads over the size limit get a clear JSON error instead of Express's HTML page.
  app.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if ((error as { type?: string })?.type === "entity.too.large") return res.status(413).json({ error: `Files can be up to ${VAULT_MAX_BYTES / 1024 / 1024} MB.` });
    next(error);
  });
}
