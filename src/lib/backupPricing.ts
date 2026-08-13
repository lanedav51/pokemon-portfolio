const API_BASE = "https://www.pokemonpricetracker.com/api/v2";

interface BackupCard {
  name?: string;
  setName?: string;
  // Printed as a full "numerator/denominator" fraction, zero-padded (e.g.
  // "022/086"), not a bare number -- confirmed against the live API.
  cardNumber?: string;
  prices?: {
    market?: number;
    low?: number;
  };
}

// "022" -> "22", but leaves promo-style codes ("SWSH001") alone -- their
// leading characters/digits are meaningful, not zero-padding.
function normalizeNumber(raw: string | undefined | null): string | null {
  const numerator = raw?.split("/")[0]?.trim();
  if (!numerator) return null;
  return /^\d+$/.test(numerator) ? String(Number(numerator)) : numerator;
}

// Module-level, so it's shared across every call in the same warm
// serverless instance -- not just within one bulk request. Once the API
// says "back off" (429 daily/minute limit, or 403 once it's gone further
// and flagged the key for abuse), every subsequent card in that same
// batch calling this concurrently would otherwise fire anyway and pile
// more 429s onto the count that triggers the abuse block in the first
// place. This is exactly what happened live: a batch kept calling after
// the daily quota was already exhausted, and the resulting burst of 429s
// got the key temporarily blocked entirely ("exceeded 50 429 requests in
// 5 minutes"). Respecting Retry-After and going silent for that long
// avoids compounding it.
let blockedUntil = 0;

/** Whether getBackupPrice is currently backing off after a rate limit/abuse block. */
export function isBackupPriceRateLimited(): boolean {
  return Date.now() < blockedUntil;
}

/**
 * Looks up a fallback market price from PokemonPriceTracker.com for cards
 * pokemontcg.io has no TCGPlayer/Cardmarket price for -- common for very
 * recently released cards or low-volume prints its sync hasn't caught up
 * on. Entirely optional: with no API key configured this silently returns
 * null so the app behaves exactly as before for anyone who hasn't signed
 * up, and any request failure (rate limit, network, unexpected response
 * shape) degrades to null rather than surfacing an error, since this is a
 * best-effort secondary source, not a required one.
 */
export async function getBackupPrice(name: string, setName: string, number: string): Promise<number | null> {
  const apiKey = process.env.POKEMON_PRICE_TRACKER_API_KEY;
  if (!apiKey) return null;
  if (Date.now() < blockedUntil) return null;

  try {
    const params = new URLSearchParams({ search: `${name} ${setName}`, limit: "10" });
    const res = await fetch(`${API_BASE}/cards?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      if (res.status === 429 || res.status === 403) {
        const retryAfterSeconds = Number(res.headers.get("retry-after")) || 60;
        blockedUntil = Date.now() + retryAfterSeconds * 1000;
        console.error(
          `PokemonPriceTracker backing off ${retryAfterSeconds}s after HTTP ${res.status} (rate limit or abuse block)`
        );
      }
      return null;
    }

    const json = (await res.json()) as { data?: BackupCard[] };
    const cards = json.data ?? [];

    // A name+set search commonly returns every alt-art/print variant of a
    // card, each with wildly different real prices (confirmed live: four
    // Mega Greninja ex variants in the same set ranged from $1 to $212) --
    // guessing via "just take the first result" silently attaches the
    // wrong variant's price. Only trust an exact collector-number match;
    // no match means no backup price, not a guessed one.
    const target = normalizeNumber(number);
    const match = cards.find((c) => normalizeNumber(c.cardNumber) === target);
    if (!match) return null;

    const price = match.prices?.market ?? match.prices?.low;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}
