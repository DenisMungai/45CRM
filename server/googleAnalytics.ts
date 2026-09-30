import { createSign } from "node:crypto";
import { ENV } from "./_core/env.js";

export function isGa4Configured() {
  return Boolean(ENV.ga4PropertyId && ENV.ga4ClientEmail && ENV.ga4PrivateKey);
}

function base64url(input: Buffer | string) {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: ENV.ga4ClientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3300,
    iat: now,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = base64url(signer.sign(ENV.ga4PrivateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || `Google auth failed (${response.status}). Check GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY.`);
  cachedToken = { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 3300) * 1000 };
  return cachedToken.token;
}

type Ga4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] };

export type Ga4Summary = {
  sessions: number;
  activeUsers: number;
  conversions: number;
  newUsers: number;
  daily: { date: string; sessions: number; conversions: number }[];
};

async function runReport(propertyId: string, token: string, body: Record<string, unknown>): Promise<Ga4Row[]> {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { rows?: Ga4Row[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `GA4 request failed (${response.status}).`);
  return payload.rows || [];
}

/** Pulls a traffic-and-conversions summary for the last `days` days from the GA4 Data API.
 * Two calls are made: one aggregated over the whole range (for accurate unique-user totals,
 * which can't be summed day-by-day without double-counting returning visitors) and one broken
 * out by day (for the trend chart, using only truly additive metrics). */
export async function getGa4Summary(days = 30): Promise<Ga4Summary> {
  if (!isGa4Configured()) throw new Error("Google Analytics is not connected. Add GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, and GA4_PRIVATE_KEY.");
  const token = await getAccessToken();
  const propertyId = ENV.ga4PropertyId.replace(/^properties\//, "");
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const metrics = [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }, { name: "newUsers" }];

  const [totalsRows, dailyRows] = await Promise.all([
    runReport(propertyId, token, { dateRanges, metrics }),
    runReport(propertyId, token, { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "conversions" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 }),
  ]);
  const t = totalsRows[0]?.metricValues || [];
  const daily = dailyRows.map((row) => {
    const raw = row.dimensionValues?.[0]?.value || "";
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    return { date, sessions: Number(row.metricValues?.[0]?.value || 0), conversions: Number(row.metricValues?.[1]?.value || 0) };
  });
  return {
    sessions: Number(t[0]?.value || 0),
    activeUsers: Number(t[1]?.value || 0),
    conversions: Number(t[2]?.value || 0),
    newUsers: Number(t[3]?.value || 0),
    daily,
  };
}
