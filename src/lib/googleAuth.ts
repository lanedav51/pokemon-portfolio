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
    client_email,
    private_key: rawKey.replace(/\\n/g, "\n"),
  };
}
