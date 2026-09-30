import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/trpc";
import { COOKIE_NAME, getSessionCookieOptions } from "./_core/cookies";
import { findUserByEmail, findUserById, listUserWorkspaces } from "./db";
import * as db from "./db";
import * as crm from "./crm";
import { sendEmail, isEmailDeliveryConfigured } from "./emailDelivery";
import { hashPassword, verifyPassword, issueSession } from "./auth";
import { serveStatic } from "./_core/vite";
import { ENV } from "./_core/env";
import * as contractsDb from "./contracts";
import { fetchDocumensoCertifiedPdf, verifyDocumensoWebhookSecret } from "./documenso";
import { handleWhatsAppWebhookVerification, handleWhatsAppWebhookEvent } from "./whatsappWebhook";

const app = express();
const server = createServer(app);
app.disable("x-powered-by");
app.use(express.json({
  limit: "3mb",
  verify: (req, _res, body) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
  },
}));
app.use(cookieParser());
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads"), { maxAge: "7d", immutable: true }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "45Creatives CRM" }));
app.get("/api/auth/me", async (req, res) => {
  try {
    const context = await createContext({ req, res });
    res.json({ user: context.user });
  } catch { res.json({ user: null }); }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return res.status(401).json({ error: "Invalid email or password." });
    const workspaces = await listUserWorkspaces(user.id);
    if (!workspaces.length) return res.status(403).json({ error: "Your account is not assigned to a workspace." });
    await db.updateUser(user.id, { lastSignedIn: new Date() });
    const token = await issueSession(user.id, workspaces[0].workspace.id);
    res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(), maxAge: 30 * 86400000 });
    res.json({ success: true });
  } catch (error) { console.error(error); res.status(500).json({ error: "Unable to sign in." }); }
});
app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) { const { hashSession } = await import("./auth"); const { deleteSession } = await import("./db"); await deleteSession(hashSession(token)); }
  res.clearCookie(COOKIE_NAME, getSessionCookieOptions());
  res.json({ success: true });
});
app.get("/api/auth/workspaces", async (req, res) => {
  const context = await createContext({ req, res });
  if (!context.user) return res.status(401).json({ error: "Unauthorized" });
  const items = await listUserWorkspaces(context.user.id);
  res.json(items.map(x => ({ id: x.workspace.id, name: x.workspace.name, role: x.membership.role })));
});

const leadCaptureRate = new Map<string, { count: number; resetAt: number }>();
function assertLeadCaptureRate(key: string) {
  const now = Date.now();
  const current = leadCaptureRate.get(key);
  if (!current || current.resetAt < now) { leadCaptureRate.set(key, { count: 1, resetAt: now + 3_600_000 }); return true; }
  if (current.count >= 30) return false;
  current.count++;
  return true;
}
app.post("/api/leads/capture/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return res.status(404).json({ error: "Unknown workspace." });
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    if (!assertLeadCaptureRate(`${workspaceId}:${ip}`)) return res.status(429).json({ error: "Too many submissions. Try again later." });
    const secret = req.get("X-Webhook-Secret") || req.get("x-webhook-secret");
    if (!secret) return res.status(401).json({ error: "Missing X-Webhook-Secret header." });
    const workspace = await db.findWorkspaceByWebhookSecret(String(secret));
    if (!workspace || workspace.id !== workspaceId) return res.status(401).json({ error: "Invalid webhook secret." });
    const name = String(req.body?.name || "").trim().slice(0, 180);
    const email = String(req.body?.email || "").trim().slice(0, 320);
    const phone = String(req.body?.phone || "").trim().slice(0, 40);
    const message = String(req.body?.message || "").trim().slice(0, 2000);
    const source = String(req.body?.source || "Website contact form").trim().slice(0, 80) || "Website contact form";
    if (!name && !email && !phone) return res.status(400).json({ error: "At least a name, email, or phone number is required." });
    const lead = await crm.upsertLead(workspaceId, {
      name: name || email || phone || "Website visitor",
      company: null,
      email: email || null,
      phone: phone || null,
      source,
      status: "new",
      estimatedValue: 0,
    });
    await db.appendDashboardActivity(workspaceId, [{ recordId: lead.id, tableName: "leads", action: "Captured", detail: `New lead "${lead.name}" captured from ${source}.${message ? ` Message: "${message.slice(0, 200)}"` : ""}`, actorUserId: null }]);
    if (isEmailDeliveryConfigured() && workspace.businessEmail) {
      sendEmail({ to: workspace.businessEmail, subject: `New lead: ${lead.name}`, html: `<p>A new lead just came in from your website.</p><p><strong>Name:</strong> ${name || "-"}<br/><strong>Email:</strong> ${email || "-"}<br/><strong>Phone:</strong> ${phone || "-"}<br/><strong>Source:</strong> ${source}</p>${message ? `<p><strong>Message:</strong><br/>${message}</p>` : ""}` }).catch(() => {});
    }
    res.json({ success: true });
  } catch (error) { console.error(error); res.status(500).json({ error: "Unable to capture lead." }); }
});

// Documenso audit-trail webhook: configure this URL (`${APP_URL}/api/webhooks/documenso`) in
// Documenso's dashboard, subscribed to at least DOCUMENT_COMPLETED (REJECTED/CANCELLED optional
// but recommended). This only updates the parallel Documenso status on the matching contract -
// the app's own signing flow and PDF are untouched either way.
const documensoStatusByEvent: Record<string, "completed" | "rejected" | "cancelled"> = {
  DOCUMENT_COMPLETED: "completed",
  DOCUMENT_REJECTED: "rejected",
  DOCUMENT_CANCELLED: "cancelled",
};
app.post("/api/webhooks/documenso", async (req, res) => {
  try {
    if (!verifyDocumensoWebhookSecret(req.get("X-Documenso-Secret") || req.get("x-documenso-secret") || undefined)) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }
    const { event, payload } = req.body || {};
    const status = documensoStatusByEvent[event as string];
    const envelopeId = payload?.envelopeId as string | undefined;
    if (!status || !envelopeId) return res.json({ received: true }); // ignore events we don't track
    const contract = await contractsDb.findContractByDocumensoEnvelopeId(envelopeId);
    if (!contract) return res.json({ received: true });
    if (status === "completed") {
      const pdf = await fetchDocumensoCertifiedPdf(envelopeId);
      const dir = path.resolve(process.cwd(), "uploads", "documenso");
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${contract.id}.pdf`);
      await fs.writeFile(filePath, pdf);
      await contractsDb.setDocumensoStatus(contract.id, "completed", `/uploads/documenso/${contract.id}.pdf`);
    } else {
      await contractsDb.setDocumensoStatus(contract.id, status);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("Documenso webhook error:", error);
    // Still 200 - Documenso retries on non-2xx, and a transient failure here (e.g. the PDF
    // download hiccuping) shouldn't produce a growing retry storm for an event we already logged.
    res.json({ received: true });
  }
});

// WhatsApp Business Cloud API Webhooks
app.get("/api/webhooks/whatsapp", handleWhatsAppWebhookVerification);
app.post("/api/webhooks/whatsapp", handleWhatsAppWebhookEvent);

app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

const port = ENV.port;
if (ENV.nodeEnv === "production") {
  serveStatic(app);
} else {
  // In dev, the frontend is served by the Vite dev server (default port 5173), which proxies
  // /api and /uploads back to this Express server. This Express server has no Vite middleware
  // of its own, so it cannot render client/index.html's module scripts. Any link that points
  // here directly (signing links, invite links, a bookmarked /login, etc.) previously returned
  // Express's raw "Cannot GET /..." 404 for every path except "/". Redirect those requests to
  // the same path on the Vite dev server instead, so links always land on a working page.
  const viteDevUrl = process.env.VITE_DEV_URL || `http://localhost:${process.env.VITE_PORT || 5173}`;
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.redirect(302, `${viteDevUrl}${req.originalUrl}`));
}

await fs.mkdir(path.resolve(process.cwd(), "uploads"), { recursive: true });
server.listen(port, () => console.log(`45Creatives CRM running at ${ENV.appUrl}`));
