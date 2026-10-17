import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "./_core/env.js";

/**
 * Public links are `<id>.<signature>`, where the signature is an HMAC of the id and a version
 * number. Nothing secret is stored, the same link can be shared many times, and bumping the
 * version revokes every link issued before. Each `kind` gets its own signatures.
 */
function signature(kind: string, id: string, version: number) {
  return createHmac("sha256", ENV.sessionSecret).update(`${kind}:${id}:${version}`).digest("base64url");
}

export function createShareToken(kind: string, id: string, version: number) {
  return `${id}.${signature(kind, id, version)}`;
}

/** The id inside a well-formed token, before its signature has been checked. */
export function shareTokenId(token: string): string | null {
  const [id, sig] = (token || "").split(".");
  return id && sig && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function verifyShareToken(kind: string, token: string, version: number): boolean {
  const [id, sig] = (token || "").split(".");
  if (!id || !sig) return false;
  const expected = Buffer.from(signature(kind, id, version));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function publicUrl(path: string) {
  return `${ENV.appUrl.replace(/\/$/, "")}${path}`;
}
