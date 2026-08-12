/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once.
 * Used to be considerate of pokemontcg.io's rate limits when refreshing
 * prices for a portfolio that might have many cards, instead of firing
 * everything at once or fully serializing it.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
