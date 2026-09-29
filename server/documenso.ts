import { timingSafeEqual } from "node:crypto";

// Documenso ("docmenso") integration - this exists ONLY to obtain a certified, independently
// auditable signature trail. It runs alongside the app's own contract signing flow (draft → sign
// as provider → send → sign as client), which stays the primary UX and PDF generator. Nothing
// here replaces that flow: it sends the already-finalized contract PDF to Documenso as a second,
// parallel envelope so both the provider and the client also sign it there.
//
// Configure via .env:
//   DOCUMENSO_API_KEY        - required. Create one under Settings > API Tokens in Documenso.
//   DOCUMENSO_API_URL        - optional. Defaults to Documenso's cloud API. Point this at
//                               "https://your-instance.example.com/api/v2" for a self-hosted server.
//   DOCUMENSO_WEBHOOK_SECRET - optional but strongly recommended. Set the same value when you add
//                               the webhook endpoint (this app's /api/webhooks/documenso URL) in
//                               Documenso's dashboard, subscribed to at least DOCUMENT_COMPLETED.

const API_BASE = (process.env.DOCUMENSO_API_URL || "https://app.documenso.com/api/v2").replace(/\/$/, "");

export function isDocumensoConfigured() {
  return Boolean(process.env.DOCUMENSO_API_KEY);
}

function authHeaders(extra?: Record<string, string>) {
  return { Authorization: process.env.DOCUMENSO_API_KEY as string, ...extra };
}

async function readErrorText(res: Response) {
  try { return await res.text(); } catch { return res.statusText; }
}

type DocumensoParty = { name: string; email: string };

export type DocumensoEnvelopeResult = {
  envelopeId: string;
  providerSigningUrl: string | null;
  clientSigningUrl: string | null;
};

/** Creates a Documenso envelope carrying the given PDF, adds the provider and client as
 * sequential signers (provider first, matching the app's own signing order), and immediately
 * distributes it so Documenso emails both parties their signing links and both signing URLs are
 * returned for display in-app too. */
export async function createDocumensoEnvelope(input: {
  contractId: string;
  title: string;
  pdfBytes: Uint8Array;
  provider: DocumensoParty;
  client: DocumensoParty;
}): Promise<DocumensoEnvelopeResult> {
  if (!isDocumensoConfigured()) throw new Error("Documenso is not configured (set DOCUMENSO_API_KEY).");

  const payload = {
    type: "DOCUMENT" as const,
    title: input.title,
    externalId: input.contractId,
    recipients: [
      {
        email: input.provider.email,
        name: input.provider.name,
        role: "SIGNER" as const,
        signingOrder: 1,
        fields: [{ identifier: 0, type: "SIGNATURE" as const, page: 1, positionX: 8, positionY: 88, width: 35, height: 5 }],
      },
      {
        email: input.client.email,
        name: input.client.name,
        role: "SIGNER" as const,
        signingOrder: 2,
        fields: [{ identifier: 0, type: "SIGNATURE" as const, page: 1, positionX: 57, positionY: 88, width: 35, height: 5 }],
      },
    ],
    meta: {
      subject: `Certified signature copy: ${input.title}`,
      message: `This is the certified signature copy of "${input.title}" for your records. You will receive (or have already received) the agreement itself by email separately - this Documenso link is only to capture a legally auditable e-signature.`,
    },
  };

  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("files", new Blob([pdfBytes(input.pdfBytes)], { type: "application/pdf" }), "agreement.pdf");

  const createRes = await fetch(`${API_BASE}/envelope/create`, { method: "POST", headers: authHeaders(), body: form });
  if (!createRes.ok) throw new Error(`Documenso envelope creation failed: ${await readErrorText(createRes)}`);
  const created = await createRes.json() as { id: string };

  const distributeRes = await fetch(`${API_BASE}/envelope/distribute`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ envelopeId: created.id }),
  });
  if (!distributeRes.ok) throw new Error(`Documenso envelope distribution failed: ${await readErrorText(distributeRes)}`);
  const distributed = await distributeRes.json() as { id: string; recipients: { email: string; signingUrl: string }[] };

  return {
    envelopeId: distributed.id,
    providerSigningUrl: distributed.recipients.find((r) => r.email === input.provider.email)?.signingUrl || null,
    clientSigningUrl: distributed.recipients.find((r) => r.email === input.client.email)?.signingUrl || null,
  };
}

// FormData's Blob constructor wants a BlobPart[]; Uint8Array satisfies that at runtime, this just
// keeps TypeScript's DOM lib happy across Node versions.
function pdfBytes(bytes: Uint8Array) { return bytes as unknown as BlobPart; }

/** Cancels a still-pending Documenso envelope, e.g. when the underlying agreement is withdrawn. */
export async function cancelDocumensoEnvelope(envelopeId: string, reason?: string) {
  if (!isDocumensoConfigured()) return;
  await fetch(`${API_BASE}/envelope/cancel`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ envelopeId, reason }),
  }).catch(() => {});
}

/** Downloads the final, Documenso-certified PDF once an envelope reaches COMPLETED. */
export async function fetchDocumensoCertifiedPdf(envelopeId: string): Promise<Buffer> {
  const detailRes = await fetch(`${API_BASE}/envelope/${envelopeId}`, { headers: authHeaders() });
  if (!detailRes.ok) throw new Error(`Could not load Documenso envelope: ${await readErrorText(detailRes)}`);
  const detail = await detailRes.json() as { envelopeItems: { id: string }[] };
  const itemId = detail.envelopeItems?.[0]?.id;
  if (!itemId) throw new Error("Documenso envelope has no document to download.");
  const downloadRes = await fetch(`${API_BASE}/envelope/item/${itemId}/download`, { headers: authHeaders() });
  if (!downloadRes.ok) throw new Error("Could not download the certified Documenso PDF.");
  return Buffer.from(await downloadRes.arrayBuffer());
}

/** Verifies the `X-Documenso-Secret` header on incoming webhook requests using a constant-time
 * comparison. Returns true (and logs a warning) when no secret is configured, since Documenso
 * sends an empty header in that case - set DOCUMENSO_WEBHOOK_SECRET to actually enforce this. */
export function verifyDocumensoWebhookSecret(receivedSecret: string | undefined) {
  const expected = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!expected) { console.warn("DOCUMENSO_WEBHOOK_SECRET is not set - accepting unverified Documenso webhooks."); return true; }
  if (!receivedSecret) return false;
  const a = Buffer.from(receivedSecret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}
