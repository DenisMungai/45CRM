export const COOKIE_NAME = "45c_session";
/** Vercel serves over HTTPS but doesn't set NODE_ENV=production in the function runtime. */
export function getSessionCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL), sameSite: "lax" as const, path: "/" };
}
