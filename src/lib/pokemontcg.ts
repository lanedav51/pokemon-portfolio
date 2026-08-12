import type { CardSearchResult } from "./types";

const API_BASE = "https://api.pokemontcg.io/v2";

interface RawTcgPlayerPrices {
  [variant: string]: {
    low?: number;
    mid?: number;
    high?: number;
    market?: number;
    directLow?: number;
  };
}

interface RawCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: {
    name: string;
    series: string;
    printedTotal: number;
  };
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    url: string;
    updatedAt: string;
    prices?: RawTcgPlayerPrices;
  };
  cardmarket?: {
    url: string;
    updatedAt: string;
    prices?: {
      averageSellPrice?: number;
      trendPrice?: number;
      lowPrice?: number;
    };
  };
}

function headers(): HeadersInit {
  const apiKey = process.env.POKEMONTCG_API_KEY;
  return apiKey ? { "X-Api-Key": apiKey } : {};
}

const RETRY_DELAYS_MS = [400, 1200];

/**
 * pokemontcg.io is a free, loosely-maintained API that intermittently
 * returns 500/502/503 under normal load with no change on our end — a
 * retry alone usually succeeds. Only transient server errors are retried;
 * 4xx (bad query, not found) fail immediately since retrying won't help.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers: headers(), next: { revalidate: 0 } });
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`pokemontcg.io returned ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("pokemontcg.io request failed");
}

// tcgplayer lists prices per print variant (holofoil, normal, etc).
// Prefer whichever variant is present, in rough order of commonness.
const VARIANT_PREFERENCE = [
  "holofoil",
  "normal",
  "reverseHolofoil",
  "1stEditionHolofoil",
  "1stEditionNormal",
  "unlimitedHolofoil",
  "unlimited",
];

function extractPrice(raw: RawCard): { price: number | null; source: "tcgplayer" | "cardmarket" | null } {
  const tcgPrices = raw.tcgplayer?.prices;
  if (tcgPrices) {
    for (const variant of VARIANT_PREFERENCE) {
      const market = tcgPrices[variant]?.market;
      if (typeof market === "number") {
        return { price: market, source: "tcgplayer" };
      }
    }
    const anyVariant = Object.values(tcgPrices)[0];
    if (anyVariant?.market) {
      return { price: anyVariant.market, source: "tcgplayer" };
    }
  }

  const cardmarketPrice = raw.cardmarket?.prices?.trendPrice ?? raw.cardmarket?.prices?.averageSellPrice;
  if (typeof cardmarketPrice === "number") {
    return { price: cardmarketPrice, source: "cardmarket" };
  }

  return { price: null, source: null };
}

function toSearchResult(raw: RawCard): CardSearchResult {
  const { price, source } = extractPrice(raw);
  return {
    id: raw.id,
    name: raw.name,
    setName: raw.set.name,
    setSeries: raw.set.series,
    number: raw.number,
    printedTotal: raw.set.printedTotal ?? null,
    imageSmall: raw.images.small,
    imageLarge: raw.images.large,
    rarity: raw.rarity ?? null,
    marketPrice: price,
    priceSource: source,
  };
}

function escapeQueryValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

async function runCardQuery(clauses: string[]): Promise<RawCard[]> {
  const params = new URLSearchParams({
    q: clauses.join(" "),
    pageSize: "20",
    orderBy: "-set.releaseDate",
  });

  const res = await fetchWithRetry(`${API_BASE}/cards?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`pokemontcg.io search failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data: RawCard[] };
  return json.data;
}

interface RawSet {
  id: string;
  name: string;
  printedTotal: number;
}

/**
 * The set's printed total (the fraction's denominator) is a strong,
 * near-unique fingerprint — far fewer sets share an exact card count than
 * share a card name. Resolving it to concrete set IDs first lets us look
 * up the card directly by set + number instead of fuzzy-matching on name,
 * which sidesteps OCR mangling the stylized name text entirely.
 */
async function getSetsByPrintedTotal(total: string): Promise<RawSet[]> {
  const params = new URLSearchParams({ q: `printedTotal:${total}`, pageSize: "50" });
  const res = await fetchWithRetry(`${API_BASE}/sets?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`pokemontcg.io set lookup failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data: RawSet[] };
  return json.data;
}

// The API's query language 500s on parenthesized OR groups combined with
// another clause, so candidate sets are queried individually and merged
// rather than joined into one "(set.id:a OR set.id:b) number:x" query.
async function findCardsBySetsAndNumber(sets: RawSet[], num: string): Promise<RawCard[]> {
  const settled = await Promise.allSettled(
    sets.map((set) => runCardQuery([`set.id:${set.id}`, `number:"${escapeQueryValue(num)}"`]))
  );

  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

function nameMatchScore(candidateName: string, guessName: string): number {
  const a = candidateName.toLowerCase();
  const b = guessName.toLowerCase().trim();
  if (!b) return 0;
  if (a === b) return 3;
  if (a.startsWith(b) || b.startsWith(a)) return 2;
  if (a.includes(b) || b.includes(a)) return 1;
  return 0;
}

/**
 * Searches pokemontcg.io by free-text name and/or a card number — either
 * one alone is enough, since the fraction (see below) is often more
 * reliable than the OCR'd name and shouldn't be required just to search.
 * `number` accepts a bare number ("184") or the full fraction ("184/159").
 *
 * When both parts of the fraction are present, the most reliable path is
 * set-by-printedTotal + exact number lookup (see findCardsBySetsAndNumber)
 * rather than trusting the OCR'd name — that tier runs first and, if a name
 * was also given, ranks results by name similarity just to put the likely
 * match first. Only if that path can't resolve anything (or no fraction was
 * given) do we fall back to progressively looser name/number search.
 */
export async function searchCards(query?: string, number?: string): Promise<CardSearchResult[]> {
  const trimmed = query?.trim() ?? "";
  const [num, total] = (number?.trim() ?? "").split("/").map((part) => part.trim());
  const hasValidFraction = Boolean(num) && Boolean(total) && /^\d+$/.test(total);

  if (!trimmed && !num) return [];

  let lastError: unknown;

  if (hasValidFraction) {
    try {
      const sets = await getSetsByPrintedTotal(total);
      if (sets.length > 0) {
        const cards = await findCardsBySetsAndNumber(sets, num);
        if (cards.length > 0) {
          const results = cards.map(toSearchResult);
          return trimmed
            ? results.sort((a, b) => nameMatchScore(b.name, trimmed) - nameMatchScore(a.name, trimmed))
            : results;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Fuzzy fallback: progressively drop constraints so a missing name or an
  // OCR mistake in the fraction never leaves the search empty.
  const nameClause = trimmed ? `name:"*${escapeQueryValue(trimmed)}*"` : null;
  const numberClause = num ? `number:"${escapeQueryValue(num)}"` : null;

  const attempts: string[][] = [];
  if (nameClause && numberClause) attempts.push([nameClause, numberClause]);
  if (nameClause) attempts.push([nameClause]);
  if (!nameClause && numberClause) attempts.push([numberClause]);

  for (const clauses of attempts) {
    try {
      const data = await runCardQuery(clauses);
      if (data.length > 0) return data.map(toSearchResult);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

export async function getCardById(id: string): Promise<CardSearchResult | null> {
  const res = await fetchWithRetry(`${API_BASE}/cards/${encodeURIComponent(id)}`);

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`pokemontcg.io lookup failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data: RawCard };
  return toSearchResult(json.data);
}
