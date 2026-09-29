import { ENV } from "./_core/env";
import { normalizePhoneNumber } from "./whatsappDb";

export function isWhatsAppCloudConfigured() {
  const token = ENV.whatsappAccessToken || ENV.whatsappToken;
  return Boolean(token && ENV.whatsappPhoneNumberId);
}

/** Formats the recipient's phone number as digits only with country code */
export function formatWhatsAppRecipient(phone: string): string {
  return normalizePhoneNumber(phone);
}

/** A wa.me click-to-chat link. Works with no API credentials - opens WhatsApp with pre-filled text. */
export function buildWhatsAppLink(phone: string, message: string) {
  const digits = formatWhatsAppRecipient(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Constructs the standard, professional agreement delivery message */
export function buildAgreementWhatsAppMessage(params: {
  clientName: string;
  projectName: string;
  providerName?: string;
  signingUrl: string;
}) {
  const provider = params.providerName || "45Creatives";
  return `Hello ${params.clientName},

Your website project agreement from ${provider} is ready for review and signature.

Please review and sign your agreement here:
${params.signingUrl}

If you have any questions, please reply to this message.

${provider}`;
}

export interface SendWhatsAppResult {
  providerId: string;
  raw: any;
}

/**
 * Sends a WhatsApp message via the Meta WhatsApp Cloud API.
 * Uses v20.0 of the Graph API.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  options?: { templateName?: string; languageCode?: string }
): Promise<SendWhatsAppResult> {
  const token = ENV.whatsappAccessToken || ENV.whatsappToken;
  if (!isWhatsAppCloudConfigured() || !token) {
    throw new Error(
      "WhatsApp Cloud API is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in settings."
    );
  }

  const to = formatWhatsAppRecipient(phone);
  if (!to || to.length < 8) {
    throw new Error(`Invalid recipient phone number: ${phone}`);
  }

  const payload: Record<string, any> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: message, preview_url: true },
  };

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${ENV.whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const resJson = (await response.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number; type?: string; fbtrace_id?: string; error_data?: { details?: string } };
  };

  if (!response.ok || resJson.error) {
    const errorMsg =
      resJson.error?.error_data?.details ||
      resJson.error?.message ||
      `WhatsApp delivery failed with status ${response.status}.`;
    throw new Error(errorMsg);
  }

  const providerId = resJson.messages?.[0]?.id || "accepted";
  return { providerId, raw: resJson };
}
