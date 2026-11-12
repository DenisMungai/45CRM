import "dotenv/config";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

/**
 * 4S Insight talks to an OpenAI-compatible chat API: Groq's free tier by default, so a deployment
 * only needs GROQ_API_KEY. AI_BASE_URL / AI_API_KEY / AI_MODEL switch to another provider.
 */
export function resolveAiConfig(env: Record<string, string | undefined>) {
  const aiBaseUrl = (env.AI_BASE_URL?.trim() || GROQ_BASE_URL).replace(/\/+$/, "");
  const groq = aiBaseUrl.includes("api.groq.com");
  return {
    aiBaseUrl,
    aiApiKey: env.AI_API_KEY?.trim() || (groq ? env.GROQ_API_KEY?.trim() : "") || "",
    aiModel: env.AI_MODEL?.trim() || (groq ? GROQ_DEFAULT_MODEL : ""),
  };
}

export const ENV = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  sessionSecret: process.env.SESSION_SECRET || "change-me-in-production",
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  ...resolveAiConfig(process.env),
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "",
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET || "",
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  whatsappWebhookUrl: process.env.WHATSAPP_WEBHOOK_URL || "",
  whatsappAgreementTemplateName: process.env.WHATSAPP_AGREEMENT_TEMPLATE_NAME || "",
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en",
  ga4PropertyId: process.env.GA4_PROPERTY_ID || "",
  ga4ClientEmail: process.env.GA4_CLIENT_EMAIL || "",
  ga4PrivateKey: (process.env.GA4_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  ownerEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@45creatives.local",
  ownerPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || "ChangeMe123!",
};
