import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "./db";
import { contracts, whatsappMessages, clients, leads, workspaces } from "../drizzle/schema";

export function normalizePhoneNumber(phone: string): string {
  // Strip non-digits
  const digits = phone.replace(/[^0-9]/g, "");
  // Handle Kenyan phone formats commonly used in CRM:
  // e.g., 0712345678 -> 254712345678
  // e.g., 0112345678 -> 254112345678
  // e.g., 712345678 -> 254712345678
  if (digits.startsWith("0") && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }
  if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    return `254${digits}`;
  }
  return digits;
}

export async function recordWhatsAppMessage(
  workspaceId: string,
  data: {
    clientId?: string | null;
    contractId?: string | null;
    direction: "outbound" | "inbound";
    phone: string;
    waMessageId?: string | null;
    messageType?: string;
    body: string;
    status?: string;
    errorMessage?: string | null;
    metadata?: Record<string, any>;
  }
) {
  const normPhone = normalizePhoneNumber(data.phone);
  return getDb()
    .insert(whatsappMessages)
    .values({
      workspaceId,
      clientId: data.clientId || null,
      contractId: data.contractId || null,
      direction: data.direction,
      phone: normPhone,
      waMessageId: data.waMessageId || null,
      messageType: data.messageType || "text",
      body: data.body,
      status: data.status || (data.direction === "inbound" ? "received" : "sent"),
      errorMessage: data.errorMessage || null,
      metadata: data.metadata || null,
      sentAt: new Date(),
    })
    .returning()
    .then((r) => r[0]);
}

export async function updateWhatsAppMessageStatus(
  waMessageId: string,
  status: "sent" | "delivered" | "read" | "failed",
  extra?: { timestamp?: Date; error?: string }
) {
  const now = extra?.timestamp || new Date();
  const updates: Record<string, any> = {
    status,
    updatedAt: now,
  };
  if (status === "delivered") updates.deliveredAt = now;
  if (status === "read") updates.readAt = now;
  if (extra?.error) updates.errorMessage = extra.error;

  return getDb()
    .update(whatsappMessages)
    .set(updates)
    .where(eq(whatsappMessages.waMessageId, waMessageId))
    .returning()
    .then((r) => r[0]);
}

export async function findContractByWhatsAppMessageId(waMessageId: string) {
  return getDb()
    .select()
    .from(contracts)
    .where(eq(contracts.whatsappMessageId, waMessageId))
    .limit(1)
    .then((r) => r[0]);
}

export async function updateContractWhatsAppStatus(
  contractId: string,
  status: "sent" | "delivered" | "read" | "failed",
  extra?: { deliveredAt?: Date; readAt?: Date }
) {
  const now = new Date();
  const updates: Record<string, any> = {
    whatsappDeliveryStatus: status,
    updatedAt: now,
  };
  if (extra?.deliveredAt || status === "delivered") {
    updates.whatsappDeliveredAt = extra?.deliveredAt || now;
  }
  if (extra?.readAt || status === "read") {
    updates.whatsappReadAt = extra?.readAt || now;
  }

  return getDb()
    .update(contracts)
    .set(updates)
    .where(eq(contracts.id, contractId))
    .returning()
    .then((r) => r[0]);
}

export async function listWhatsAppMessagesForContract(workspaceId: string, contractId: string) {
  return getDb()
    .select()
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.contractId, contractId)))
    .orderBy(desc(whatsappMessages.createdAt));
}

export async function listWhatsAppMessagesForClient(workspaceId: string, clientId: string) {
  return getDb()
    .select()
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.clientId, clientId)))
    .orderBy(desc(whatsappMessages.createdAt));
}

export async function findClientOrLeadByPhone(rawPhone: string) {
  const norm = normalizePhoneNumber(rawPhone);
  const rawDigits = rawPhone.replace(/[^0-9]/g, "");

  // Search clients first
  const db = getDb();
  const clientMatch = await db
    .select()
    .from(clients)
    .where(
      or(
        eq(clients.phone, rawPhone),
        eq(clients.phone, norm),
        eq(clients.phone, `+${norm}`),
        eq(clients.phone, rawDigits)
      )
    )
    .limit(1)
    .then((r) => r[0]);

  if (clientMatch) {
    return { type: "client" as const, client: clientMatch, workspaceId: clientMatch.workspaceId };
  }

  // Search leads
  const leadMatch = await db
    .select()
    .from(leads)
    .where(
      or(
        eq(leads.phone, rawPhone),
        eq(leads.phone, norm),
        eq(leads.phone, `+${norm}`),
        eq(leads.phone, rawDigits)
      )
    )
    .limit(1)
    .then((r) => r[0]);

  if (leadMatch) {
    return { type: "lead" as const, lead: leadMatch, workspaceId: leadMatch.workspaceId };
  }

  // Default fallback workspace if none found
  const defaultWs = await db.select().from(workspaces).limit(1).then((r) => r[0]);
  return { type: "unknown" as const, workspaceId: defaultWs?.id || null };
}
