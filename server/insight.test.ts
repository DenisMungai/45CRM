import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./_core/trpc";

vi.mock("./_core/llm", () => ({
  listLLMModels: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./domain", () => ({
  listDomainRows: vi.fn().mockResolvedValue([]),
}));

import { invokeLLM, listLLMModels } from "./_core/llm";
import { appRouter } from "./routers";

const testUser: AuthUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@45creatives.local",
  name: "Test Admin",
  role: "admin",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  workspaceName: "45Creatives",
  providerImageUrl: null,
  avatarUrl: null,
  lastSignedIn: null,
};

describe("4S Insight server assistant", () => {
  beforeEach(() => {
    vi.mocked(listLLMModels).mockResolvedValue({ object: "list", data: [{ id: "gpt-5-mini", object: "model", created: 0, owned_by: "openai" }] });
    vi.mocked(invokeLLM).mockResolvedValue({ id: "chat-1", created: 0, model: "gpt-5-mini", choices: [{ index: 0, message: { role: "assistant", content: "Follow up with the overdue invoice." }, finish_reason: "stop" }] });
  });

  it("retries once when the first model response has no readable content", async () => {
    vi.mocked(invokeLLM)
      .mockResolvedValueOnce({ id: "chat-empty", created: 0, model: "gpt-5-mini", choices: [{ index: 0, message: { role: "assistant", content: [] }, finish_reason: "stop" }] })
      .mockResolvedValueOnce({ id: "chat-retry", created: 0, model: "gpt-5-mini", choices: [{ index: 0, message: { role: "assistant", content: [{ type: "output_text", text: "Start with the overdue invoice." }] }, finish_reason: "stop" }] });

    const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: testUser });
    const result = await caller.insight.chat({
      messages: [{ role: "user", content: "What needs attention?" }],
      context: { invoices: [], inventory: [], projects: [], transactions: [] },
    });

    expect(result).toEqual({ answer: "Start with the overdue invoice.", model: "gpt-5-mini" });
    expect(invokeLLM).toHaveBeenCalledTimes(2);
  });

  it("keeps workspace context server-side and returns the generated answer", async () => {
    const caller = appRouter.createCaller({ req: {} as never, res: {} as never, user: testUser });
    const result = await caller.insight.chat({
      messages: [{ role: "user", content: "What needs attention?" }],
      context: { invoices: [["INV-1", "Client", "", "", "KSh 10", "Overdue"]], inventory: [], projects: [], transactions: [] },
    });

    expect(result).toEqual({ answer: "Follow up with the overdue invoice.", model: "gpt-5-mini" });
    expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-mini" }));
    const request = vi.mocked(invokeLLM).mock.calls.find(([params]) => String(params.messages[0].content).includes("INV-1"))?.[0];
    expect(request).toBeDefined();
  });
});
