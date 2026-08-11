/**
 * .env.local wraps the key in double quotes (normal .env file syntax, which
 * Next.js's own loader strips automatically). Dashboard-based hosts like
 * Netlify/Vercel don't parse .env syntax though — they store literally
 * whatever's pasted in, so if someone copies the value including those
 * outer quotes, the quote characters end up glued onto the PEM data itself
 * and break OpenSSL's parser. Stripping them defensively here means it
 * works either way.
 */
function unwrapQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Both the Sheets and Vision clients authenticate as the same service account.
 * The private key is stored in env with literal "\n" sequences (how most hosts
 * store multi-line secrets), so it needs unescaping before use.
 */
export function getGoogleCredentials(): { client_email: string; private_key: string } {
  const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!client_email || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars. See README for setup."
    );
  }

  return {
    client_email: unwrapQuotes(client_email),
    private_key: unwrapQuotes(rawKey).replace(/\\n/g, "\n"),
  };
}
