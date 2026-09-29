import { ENV } from "./_core/env";

export function isWhatsAppCloudConfigured() {
  return Boolean(ENV.whatsappToken && ENV.whatsappPhoneNumberId);
}

function digitsOnly(phone: string) {
  return phone.replace(/[^0-9]/g, "");
}

/** A wa.me click-to-chat link. Works with no API credentials - the recipient's own
 * WhatsApp opens with the message pre-filled and the sender taps send. */
export function buildWhatsAppLink(phone: string, message: string) {
  const digits = digitsOnly(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Sends a WhatsApp message via the Cloud API on the business's behalf. Requires
 * WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID; throws if not configured so callers
 * can fall back to buildWhatsAppLink(). */
export async function sendWhatsAppMessage(phone: string, message: string) {
  if (!isWhatsAppCloudConfigured()) throw new Error("WhatsApp Cloud API is not configured. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID, or use the WhatsApp link instead.");
  const to = digitsOnly(phone);
  const r = await fetch(`https://graph.facebook.com/v20.0/${ENV.whatsappPhoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.whatsappToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message, preview_url: true } }),
  });
  const payload = (await r.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(payload.error?.message || `WhatsApp delivery failed (${r.status}).`);
  return { providerId: payload.messages?.[0]?.id || "accepted" };
}
