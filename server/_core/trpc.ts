import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import superjson from "superjson";
import { findSession, touchSession } from "../db.js";
import { COOKIE_NAME } from "./cookies.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  workspaceId: string;
  workspaceName: string;
  providerImageUrl: string | null;
  avatarUrl: string | null;
  lastSignedIn: Date | null;
};
export type Context = { req: Request; res: Response; user: AuthUser | null };

function tokenFromRequest(req: Request) {
  const cookie = req.cookies?.[COOKIE_NAME] as string | undefined;
  const auth = req.headers.authorization;
  return cookie || (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined);
}
export async function createContext({ req, res }: { req: Request; res: Response }): Promise<Context> {
  const token = tokenFromRequest(req);
  if (!token) return { req, res, user: null };
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  const found = await findSession(hash).catch(() => undefined);
  if (!found || found.session.expiresAt < new Date()) return { req, res, user: null };
  void touchSession(found.session.id);
  return { req, res, user: { id: found.user.id, email: found.user.email, name: found.user.name, role: found.membership.role === "owner" ? "admin" : found.membership.role, workspaceId: found.workspace.id, workspaceName: found.workspace.name, providerImageUrl: found.user.providerImageUrl, avatarUrl: found.user.avatarUrl, lastSignedIn: found.user.lastSignedIn } };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  // Any error that isn't a deliberate TRPCError thrown by app code (validation, NOT_FOUND, etc.)
  // is an unexpected failure - most often a raw database driver error, which by default carries
  // the full SQL statement, bound parameters (including other users' UUIDs), and internal schema
  // details in its `message`. tRPC sends that message to the client verbatim unless we replace it,
  // so we log the real error server-side and swap in a generic message for anything unexpected.
  errorFormatter({ shape, error }) {
    if (error.code === "INTERNAL_SERVER_ERROR" && !(error.cause instanceof TRPCError)) {
      console.error("Unhandled server error:", error.cause || error);
      return { ...shape, message: "Something went wrong on our end. Please try again." };
    }
    return shape;
  },
});
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to continue." });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
