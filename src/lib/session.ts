// Uses the Web Crypto API (crypto.subtle) rather than Node's `crypto` module
// so this works in both the Node.js runtime (API routes) and the Edge
// runtime (middleware) without a runtime-specific code path.

const encoder = new TextEncoder();
const SESSION_DURATION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET env var. See README for setup.");
  return secret;
}

function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Session token: "{expiryTimestamp}.{base64url HMAC signature of the expiry}". */
export async function createSessionToken(): Promise<string> {
  const expires = Date.now() + SESSION_DURATION_MS;
  const key = await getKey(getSecret());
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(expires)));
  return `${expires}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;

  const expiresPart = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);
  const expires = Number(expiresPart);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  try {
    const key = await getKey(getSecret());
    // subtle.verify does a constant-time comparison internally.
    return await crypto.subtle.verify("HMAC", key, fromBase64Url(signaturePart), encoder.encode(expiresPart));
  } catch {
    return false;
  }
}

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = SESSION_DURATION_MS / 1000;
