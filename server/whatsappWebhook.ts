import type { Request, Response } from "express";
import { ENV } from "./_core/env";
import * as waDb from "./whatsappDb";
import { appendDashboardActivity } from "./db";

/**
 * Handles Meta WhatsApp Cloud API Webhook Verification (GET).
 * Meta sends hub.mode, hub.verify_token, hub.challenge to verify the endpoint URL.
 */
export async function handleWhatsAppWebhookVerification(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || ENV.whatsappVerifyToken;

  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    console.log("[WhatsApp Webhook] Verification successful");
    return res.status(200).send(challenge);
  }

  console.warn("[WhatsApp Webhook] Verification failed - token mismatch or missing mode", {
    receivedMode: mode,
    receivedToken: token ? `${String(token).slice(0, 4)}***` : "none",
  });
  return res.status(403).send("Forbidden");
}

/**
 * Handles incoming WhatsApp webhook events (POST).
 * Handles message delivery statuses (sent, delivered, read, failed)
 * and incoming customer replies.
 */
export async function handleWhatsAppWebhookEvent(req: Request, res: Response) {
  try {
    const body = req.body;

    if (!body || body.object !== "whatsapp_business_account") {
      return res.status(200).json({ status: "ignored" });
    }

    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];

      for (const change of changes) {
        const value = change.value;
        if (!value || value.messaging_product !== "whatsapp") continue;

        // 1. Process Message Status Updates (sent -> delivered -> read -> failed)
        if (Array.isArray(value.statuses)) {
          for (const statusObj of value.statuses) {
            const waMessageId = statusObj.id;
            const status = statusObj.status as "sent" | "delivered" | "read" | "failed";
            const timestamp = statusObj.timestamp
              ? new Date(Number(statusObj.timestamp) * 1000)
              : new Date();
            const recipientId = statusObj.recipient_id;
            const errorObj = statusObj.errors?.[0];
            const errorMessage = errorObj ? `${errorObj.title || errorObj.message} (code ${errorObj.code})` : undefined;

            if (waMessageId && status) {
              await waDb.updateWhatsAppMessageStatus(waMessageId, status, {
                timestamp,
                error: errorMessage,
              });

              // Check if linked to an active agreement/contract
              const contract = await waDb.findContractByWhatsAppMessageId(waMessageId);
              if (contract) {
                await waDb.updateContractWhatsAppStatus(contract.id, status, {
                  deliveredAt: status === "delivered" ? timestamp : undefined,
                  readAt: status === "read" ? timestamp : undefined,
                });

                // Record CRM dashboard activity
                if (status === "delivered") {
                  await appendDashboardActivity(contract.workspaceId, [
                    {
                      recordId: contract.id,
                      tableName: "contracts",
                      action: "WhatsApp Delivered",
                      detail: `Agreement "${contract.title}" delivered to ${contract.clientName} (${recipientId || contract.clientPhone}).`,
                      actorUserId: null,
                    },
                  ]);
                } else if (status === "read") {
                  await appendDashboardActivity(contract.workspaceId, [
                    {
                      recordId: contract.id,
                      tableName: "contracts",
                      action: "WhatsApp Read",
                      detail: `${contract.clientName} opened and read the agreement link message on WhatsApp.`,
                      actorUserId: null,
                    },
                  ]);
                } else if (status === "failed") {
                  await appendDashboardActivity(contract.workspaceId, [
                    {
                      recordId: contract.id,
                      tableName: "contracts",
                      action: "WhatsApp Failed",
                      detail: `Delivery of agreement "${contract.title}" to ${contract.clientName} failed.${errorMessage ? ` Error: ${errorMessage}` : ""}`,
                      actorUserId: null,
                    },
                  ]);
                }
              }
            }
          }
        }

        // 2. Process Incoming Messages from Clients
        if (Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            const senderPhone = msg.from;
            const waMsgId = msg.id;
            const msgType = msg.type;
            const textBody =
              msg.text?.body ||
              (msgType === "button" ? msg.button?.text : "") ||
              (msgType === "interactive" ? msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title : "") ||
              `[${msgType} message]`;

            if (senderPhone && textBody) {
              // Match phone to client or lead
              const lookup = await waDb.findClientOrLeadByPhone(senderPhone);
              const workspaceId = lookup.workspaceId;

              if (workspaceId) {
                const clientId = lookup.type === "client" ? lookup.client.id : null;
                const clientName =
                  lookup.type === "client"
                    ? lookup.client.name
                    : lookup.type === "lead"
                    ? lookup.lead.name
                    : senderPhone;

                // Save inbound message
                await waDb.recordWhatsAppMessage(workspaceId, {
                  clientId,
                  direction: "inbound",
                  phone: senderPhone,
                  waMessageId: waMsgId,
                  messageType: msgType || "text",
                  body: textBody,
                  status: "received",
                  metadata: { raw: msg },
                });

                // Post activity event in CRM dashboard
                await appendDashboardActivity(workspaceId, [
                  {
                    recordId: clientId || `wa-${senderPhone}`,
                    tableName: lookup.type === "client" ? "clients" : lookup.type === "lead" ? "leads" : "whatsapp",
                    action: "WhatsApp Reply",
                    detail: `Incoming WhatsApp reply from ${clientName} (${senderPhone}): "${textBody.slice(0, 160)}"`,
                    actorUserId: null,
                  },
                ]);
              }
            }
          }
        }
      }
    }

    return res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("[WhatsApp Webhook] Processing error:", error);
    // Always return 200 to Meta to prevent retry floods on transient errors
    return res.status(200).json({ status: "error", error: (error as Error).message });
  }
}
