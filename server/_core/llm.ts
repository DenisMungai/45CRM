import { ENV } from "./env.js";

type Message = { role: "system" | "user" | "assistant"; content: string };
export async function listLLMModels() { return { data: [{ id: ENV.openAiModel }] }; }
export async function invokeLLM(input: { model?: string; maxTokens?: number; messages: Message[]; responseFormat?: { type: string } }) {
  if (!ENV.openAiApiKey) {
    const last = [...input.messages].reverse().find(m => m.role === "user")?.content || "your request";
    return { model: "local-fallback", choices: [{ message: { content: `I’m ready to analyze the 45Creatives workspace. I don’t have an AI provider configured yet, so I can’t perform live AI analysis for: “${last}”. Set OPENAI_API_KEY on the Node.js server to enable 4S Insight.` } }] };
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${ENV.openAiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: input.model || ENV.openAiModel, max_tokens: input.maxTokens || 900, messages: input.messages, response_format: input.responseFormat }) });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  return await response.json() as any;
}
