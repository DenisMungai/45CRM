import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Express tRPC API route", () => {
  it("returns JSON for an unauthenticated protected mutation/query instead of HTML", async () => {
    const app = express();
    app.use("/api/trpc", createExpressMiddleware({
      router: appRouter,
      createContext: ({ req, res }) => Promise.resolve({ req, res, user: null }),
    }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/trpc/records.list?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null } }))}`);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).not.toContain("<!doctype");
    expect(JSON.parse(body)[0]?.error?.json?.data?.code).toBe("UNAUTHORIZED");
  });
});
