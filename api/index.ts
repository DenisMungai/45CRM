/**
 * Vercel serverless entry point.
 * Re-uses the full Express app but does NOT call server.listen() —
 * Vercel manages the HTTP lifecycle itself.
 */
import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../server/routers";
import { createContext } from "../server/_core/trpc";
import { COOKIE_NAME, getSessionCookieOptions } from "../server/_core/cookies";
import {
  findUserByEmail,
  listUserWorkspaces,
  appendDashboardActivity,
  findWorkspaceByWebhookSecret,
} from "../server/db";
import { upsertLead } from "../server/crm";
import { sendEmail, isEmailDeliveryConfigured } from "../server/emailDelivery";
import { verifyPassword, issueSession } from "../server/auth";
import { ENV } from "../server/_core/env";
import {
  findContractByDocumensoEnvelopeId,
  setDocumensoStatus,
} from "../server/contracts";
import {
  fetchDocumensoCertifiedPdf,
  verifyDocumensoWebhookSecret,
} from "../server/documenso";
import { updateUser } from "../server/db";
import { deleteSession } from "../server/db";
import { hashSession } from "../server/auth";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  handleWhatsAppWebhookVerification,
  handleWhatsAppWebhookEvent,
} from "../server/whatsappWebhook";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());

// Serve uploaded files (avatars, etc.) — /tmp on Vercel, so warn if missing
const uploadsPath = path.resolve(process.cwd(), "uploads");
if (fs.existsSync(uploadsPath)) {
  app.use(
    "/uploads",
    express.static(uploadsPath, { maxAge: "7d", immutable: true })
  );
}

// ── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "45Creatives CRM" })
);

// ── Auth ─────────────────────────────────────────────────────────────────────
app.get("/api/auth/me", async (req, res) => {
  try {
    const context = await createContext({ req: req as any, res: res as any });
    res.json({ user: context.user });
  } catch {
    res.json({ user: null });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password)
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return res.status(401).json({ error: "Invalid email or password." });
    const workspaces = await listUserWorkspaces(user.id);
    if (!workspaces.length)
      return res
        .status(403)
        .json({ error: "Your account is not assigned to a workspace." });
    await updateUser(user.id, { lastSignedIn: new Date() });
    const token = await issueSession(user.id, workspaces[0].workspace.id);
    res.cookie(COOKIE_NAME, token, {
      ...getSessionCookieOptions(),
      maxAge: 30 * 86_400_000,
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to sign in." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    await deleteSession(hashSession(token));
  }
  res.clearCookie(COOKIE_NAME, getSessionCookieOptions());
  res.json({ success: true });
});

app.get("/api/auth/workspaces", async (req, res) => {
  const context = await createContext({ req: req as any, res: res as any });
  if (!context.user) return res.status(401).json({ error: "Unauthorized" });
  const items = await listUserWorkspaces(context.user.id);
  res.json(
    items.map((x) => ({
      id: x.workspace.id,
      name: x.workspace.name,
      role: x.membership.role,
    }))
  );
});

// ── Lead capture webhook ──────────────────────────────────────────────────────
const leadCaptureRate = new Map<string, { count: number; resetAt: number }>();
function assertLeadCaptureRate(key: string) {
  const now = Date.now();
  const current = leadCaptureRate.get(key);
  if (!current || current.resetAt < now) {
    leadCaptureRate.set(key, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count++;
  return true;
}

app.post("/api/leads/capture/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId))
      return res.status(404).json({ error: "Unknown workspace." });
    const ip = String(
      req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"
    )
      .split(",")[0]
      .trim();
    if (!assertLeadCaptureRate(`${workspaceId}:${ip}`))
      return res
        .status(429)
        .json({ error: "Too many submissions. Try again later." });
    const secret =
      req.get("X-Webhook-Secret") || req.get("x-webhook-secret");
    if (!secret)
      return res
        .status(401)
        .json({ error: "Missing X-Webhook-Secret header." });
    const workspace = await findWorkspaceByWebhookSecret(String(secret));
    if (!workspace || workspace.id !== workspaceId)
      return res.status(401).json({ error: "Invalid webhook secret." });
    const name = String(req.body?.name || "").trim().slice(0, 180);
    const email = String(req.body?.email || "").trim().slice(0, 320);
    const phone = String(req.body?.phone || "").trim().slice(0, 40);
    const message = String(req.body?.message || "").trim().slice(0, 2000);
    const source = String(
      req.body?.source || "Website contact form"
    )
      .trim()
      .slice(0, 80) || "Website contact form";
    if (!name && !email && !phone)
      return res.status(400).json({
        error: "At least a name, email, or phone number is required.",
      });
    const lead = await upsertLead(workspaceId, {
      name: name || email || phone || "Website visitor",
      company: null,
      email: email || null,
      phone: phone || null,
      source,
      status: "new",
      estimatedValue: 0,
    });
    await appendDashboardActivity(workspaceId, [
      {
        recordId: lead.id,
        tableName: "leads",
        action: "Captured",
        detail: `New lead "${lead.name}" captured from ${source}.${message ? ` Message: "${message.slice(0, 200)}"` : ""}`,
        actorUserId: null,
      },
    ]);
    if (isEmailDeliveryConfigured() && workspace.businessEmail) {
      sendEmail({
        to: workspace.businessEmail,
        subject: `New lead: ${lead.name}`,
        html: `<p>A new lead just came in from your website.</p><p><strong>Name:</strong> ${name || "-"}<br/><strong>Email:</strong> ${email || "-"}<br/><strong>Phone:</strong> ${phone || "-"}<br/><strong>Source:</strong> ${source}</p>${message ? `<p><strong>Message:</strong><br/>${message}</p>` : ""}`,
      }).catch(() => {});
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to capture lead." });
  }
});

// ── Documenso webhook ─────────────────────────────────────────────────────────
const documensoStatusByEvent: Record<string, string> = {
  DOCUMENT_COMPLETED: "completed",
  DOCUMENT_REJECTED: "rejected",
  DOCUMENT_CANCELLED: "cancelled",
};

app.post("/api/webhooks/documenso", async (req, res) => {
  try {
    if (
      !verifyDocumensoWebhookSecret(
        req.get("X-Documenso-Secret") ||
          req.get("x-documenso-secret") ||
          undefined
      )
    ) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }
    const { event, payload } = req.body || {};
    const status = documensoStatusByEvent[event] as any;
    const envelopeId = payload?.envelopeId;
    if (!status || !envelopeId) return res.json({ received: true });
    const contract = await findContractByDocumensoEnvelopeId(envelopeId);
    if (!contract) return res.json({ received: true });
    if (status === "completed") {
      const pdf = await fetchDocumensoCertifiedPdf(envelopeId);
      // On Vercel /tmp is the only writable dir — store path accordingly
      const filePath = `/tmp/documenso-${contract.id}.pdf`;
      fs.writeFileSync(filePath, pdf);
      await setDocumensoStatus(contract.id, "completed", filePath);
    } else {
      await setDocumensoStatus(contract.id, status);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("Documenso webhook error:", error);
    res.json({ received: true });
  }
});

// ── WhatsApp webhook ─────────────────────────────────────────────────────────
app.get("/api/webhooks/whatsapp", handleWhatsAppWebhookVerification);
app.post("/api/webhooks/whatsapp", handleWhatsAppWebhookEvent);

// ── tRPC ──────────────────────────────────────────────────────────────────────
app.use(
  "/api/trpc",
  createExpressMiddleware({ router: appRouter, createContext })
);

// Export the Express app as the default export for Vercel
export default app;
