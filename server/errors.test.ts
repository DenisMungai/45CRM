import { describe, expect, it } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./_core/trpc";

describe("API error responses", () => {
  const appRouter = router({
    boom: publicProcedure.query(() => { throw new Error("relation \"invoices\" failed at /var/task/server/db.ts"); }),
    known: publicProcedure.query(() => { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Add billing credit." }); }),
  });
  const call = async (path: string) => {
    const res = await fetchRequestHandler({ endpoint: "/api/trpc", req: new Request(`http://localhost/api/trpc/${path}`), router: appRouter, createContext: () => ({ req: {} as never, res: {} as never, user: null }) });
    return { status: res.status, body: await res.text() };
  };

  it("hides unexpected errors and never sends a stack trace", async () => {
    const { status, body } = await call("boom");
    expect(status).toBe(500);
    expect(body).toContain("Something went wrong on our end");
    expect(body).not.toContain("stack");
    expect(body).not.toContain("/var/task");
  });

  it("hides stack traces on Vercel even when NODE_ENV is development", async () => {
    const previous = { nodeEnv: process.env.NODE_ENV, vercel: process.env.VERCEL };
    process.env.NODE_ENV = "development"; process.env.VERCEL = "1";
    try {
      const { body } = await call("boom");
      expect(body).not.toContain("stack");
      expect(body).not.toContain("/var/task");
    } finally {
      process.env.NODE_ENV = previous.nodeEnv;
      if (previous.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.vercel;
    }
  });

  it("passes deliberate messages through without a stack trace", async () => {
    const { status, body } = await call("known");
    expect(status).toBe(412);
    expect(body).toContain("Add billing credit.");
    expect(body).not.toContain("stack");
  });
});
