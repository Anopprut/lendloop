// HMAC-SHA256 signing shared by the n8n webhook (outbound) and the HTTP endpoints (inbound).
// Signed string: `${timestamp}.${method}.${path}.${body}`; n8n uses the identical format.

const encoder = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison (avoids leaking how many leading characters matched). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function signingString(ts: string, method: string, path: string, body: string): string {
  return `${ts}.${method}.${path}.${body}`;
}

export const MAX_SKEW_SECONDS = 300;

export function timestampIsFresh(ts: string, nowMs = Date.now()): boolean {
  const n = Number(ts);
  return Number.isFinite(n) && Math.abs(nowMs / 1000 - n) <= MAX_SKEW_SECONDS;
}

export async function verifySignature(opts: {
  secret: string | undefined;
  ts: string | null;
  sig: string | null;
  method: string;
  path: string;
  body: string;
  nowMs?: number;
}): Promise<boolean> {
  const { secret, ts, sig, method, path, body, nowMs } = opts;
  if (!secret || !ts || !sig) return false;
  if (!timestampIsFresh(ts, nowMs)) return false;
  const expected = await hmacHex(secret, signingString(ts, method, path, body));
  return timingSafeEqual(expected, sig);
}
