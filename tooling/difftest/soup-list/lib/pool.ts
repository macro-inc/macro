/** Runs `work` over `items` with at most `limit` in flight; keeps input order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  { timeoutMs, intervalMs = 100 }: { timeoutMs: number; intervalMs?: number }
): Promise<{ value: T | undefined; elapsedMs: number }> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value !== undefined) return { value, elapsedMs: Date.now() - start };
    if (Date.now() - start >= timeoutMs) return { value: undefined, elapsedMs: Date.now() - start };
    await Bun.sleep(intervalMs);
  }
}
