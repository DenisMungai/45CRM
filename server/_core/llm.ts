import { TRPCError } from "@trpc/server";
import { ENV } from "./env.js";

type Message = { role: "system" | "user" | "assistant"; content: string };
export async function listLLMModels() { return { data: [{ id: ENV.aiModel }] }; }

/** Reasoning models (OpenAI gpt-5* and o-series, gpt-oss on Groq) spend part of the token budget
 * thinking, so they get more headroom and the lowest effort that still answers well. */
const isReasoningModel = (model: string) => /^(gpt-5|o\d)|gpt-oss/i.test(model);
const providerName = () => {
  const host = (() => { try { return new URL(ENV.aiBaseUrl).hostname; } catch { return ""; } })();
  return host.includes("groq") ? "Groq" : host.includes("googleapis") ? "Google Gemini" : host.includes("openrouter") ? "OpenRouter" : host.includes("openai") ? "OpenAI" : "the AI provider";
};

/** Turns a provider error response into a message the dashboard can show as-is. */
async function providerError(response: Response): Promise<TRPCError> {
  type ProviderError = { code?: string | number; type?: string; status?: string; message?: string };
  // OpenAI and Groq send { error }, Gemini's OpenAI-compatible API sometimes sends [{ error }].
  const raw = await response.json().catch(() => null) as { error?: ProviderError } | Array<{ error?: ProviderError }> | null;
  const error = Array.isArray(raw) ? raw[0]?.error : raw?.error;
  const code = String(error?.code || error?.type || error?.status || "");
  const provider = providerName();
  console.error(`AI provider (${provider}) returned ${response.status}:`, error?.message || code || "no details");
  if (response.status === 401 || response.status === 403) return new TRPCError({ code: "PRECONDITION_FAILED", message: `4S Insight can't sign in to ${provider}: the API key on the server (GROQ_API_KEY or AI_API_KEY) is missing, invalid or revoked.` });
  if (code === "insufficient_quota") return new TRPCError({ code: "PRECONDITION_FAILED", message: `4S Insight is unavailable: the ${provider} account has run out of credit. Add credit, or switch AI_BASE_URL / AI_API_KEY / AI_MODEL to a free provider.` });
  if (response.status === 429) return new TRPCError({ code: "TOO_MANY_REQUESTS", message: `${provider} is rate limiting 4S Insight right now (free plans allow a limited number of requests per minute and per day). Wait a minute and try again.` });
  if (response.status === 404 || code === "model_not_found") return new TRPCError({ code: "PRECONDITION_FAILED", message: `The AI model "${ENV.aiModel}" isn't available on ${provider}. Set AI_MODEL to a model your key can use.` });
  if (response.status === 413 || code === "request_too_large" || /context|too large|tokens/i.test(error?.message || "")) return new TRPCError({ code: "PRECONDITION_FAILED", message: `Your workspace summary is too large for ${provider}'s current limits. Ask a narrower question, or use a model with a bigger allowance.` });
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "4S Insight couldn't get an answer from the AI provider. Please try again shortly." });
}

export async function invokeLLM(input: { model?: string; maxTokens?: number; messages: Message[]; responseFormat?: { type: string } }) {
  if (!ENV.aiApiKey) {
    const last = [...input.messages].reverse().find(m => m.role === "user")?.content || "your request";
    return { model: "local-fallback", choices: [{ message: { content: `I’m ready to analyze the 45Creatives workspace. I don’t have an AI provider configured yet, so I can’t perform live AI analysis for: “${last}”. Set GROQ_API_KEY on the server (free key from console.groq.com) to enable 4S Insight.` } }] };
  }
  const model = input.model || ENV.aiModel;
  const reasoning = isReasoningModel(model);
  const maxTokens = input.maxTokens || 900;
  const body = {
    model,
    messages: input.messages,
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    // `max_completion_tokens` is accepted by OpenAI, Groq and Gemini's OpenAI-compatible API alike.
    max_completion_tokens: reasoning ? Math.max(maxTokens * 3, 2500) : maxTokens,
    ...(reasoning ? { reasoning_effort: "low" } : {}),
    // Groq returns gpt-oss reasoning in a separate field; the dashboard only shows the answer.
    ...(reasoning && ENV.aiBaseUrl.includes("api.groq.com") ? { include_reasoning: false } : {}),
  };
  const response = await fetch(`${ENV.aiBaseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${ENV.aiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw await providerError(response);
  return await response.json() as any;
}
