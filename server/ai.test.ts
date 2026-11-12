import { describe, expect, it } from "vitest";
import { GROQ_BASE_URL, GROQ_DEFAULT_MODEL, resolveAiConfig } from "./_core/env";

describe("AI provider settings", () => {
  it("uses Groq by default with only GROQ_API_KEY set", () => {
    expect(resolveAiConfig({ GROQ_API_KEY: "gsk_test" })).toEqual({ aiBaseUrl: GROQ_BASE_URL, aiApiKey: "gsk_test", aiModel: GROQ_DEFAULT_MODEL });
  });
  it("ignores old OpenAI variables entirely", () => {
    expect(resolveAiConfig({ OPENAI_API_KEY: "sk-old", OPENAI_MODEL: "gpt-5-mini" })).toEqual({ aiBaseUrl: GROQ_BASE_URL, aiApiKey: "", aiModel: GROQ_DEFAULT_MODEL });
  });
  it("lets AI_* switch to another OpenAI-compatible provider", () => {
    expect(resolveAiConfig({ AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/", AI_API_KEY: "g-key", AI_MODEL: "gemini-flash", GROQ_API_KEY: "gsk_test" })).toEqual({ aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", aiApiKey: "g-key", aiModel: "gemini-flash" });
  });
  it("does not send the Groq key to another provider", () => {
    expect(resolveAiConfig({ AI_BASE_URL: "https://api.openai.com/v1", GROQ_API_KEY: "gsk_test" }).aiApiKey).toBe("");
  });
});
