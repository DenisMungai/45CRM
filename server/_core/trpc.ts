import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import superjson from "superjson";
import { ZodError } from "zod";
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
  const now = new Date();
  const shouldTouchUser = !found.user.lastSignedIn || (now.getTime() - new Date(found.user.lastSignedIn).getTime() > 15 * 60 * 1000);
  // Session activity is best-effort; a write failure must not turn every authenticated
  // API request into an unhandled rejection (or take down a serverless invocation).
  void touchSession(found.session.id, shouldTouchUser ? found.user.id : undefined, found.user.lastSignedIn)
    .catch((error) => console.error("Unable to update session activity:", error));
  const effectiveLastSignedIn = shouldTouchUser ? now : found.user.lastSignedIn;
  return { req, res, user: { id: found.user.id, email: found.user.email, name: found.user.name, role: found.membership.role === "owner" ? "admin" : found.membership.role, workspaceId: found.workspace.id, workspaceName: found.workspace.name, providerImageUrl: found.user.providerImageUrl, avatarUrl: found.user.avatarUrl, lastSignedIn: effectiveLastSignedIn } };
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
    // Input validation failures otherwise reach the UI as a raw JSON dump of Zod issues.
    if (error.code === "BAD_REQUEST" && error.cause instanceof ZodError) {
      return { ...shape, message: formatZodError(error.cause) };
    }
    return shape;
  },
});

function fieldLabel(path: PropertyKey[]) {
  const key = [...path].reverse().find((part) => typeof part === "string");
  if (!key) return "A field";
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatZodError(zodError: ZodError) {
  const messages = zodError.issues.slice(0, 3).map((issue) => {
    const label = fieldLabel(issue.path);
    if (issue.code === "too_big" && issue.origin === "string") return `${label} is too long (max ${issue.maximum} characters).`;
    if (issue.code === "too_big" && issue.origin === "number") return `${label} must be at most ${issue.maximum}.`;
    if (issue.code === "too_small" && issue.origin === "string" && Number(issue.minimum) <= 1) return `${label} is required.`;
    return `${label}: ${issue.message}`;
  });
  return messages.join(" ");
}
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to continue." });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
