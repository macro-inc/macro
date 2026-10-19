/** Runs `task` on every item, `limit` at a time, starting them in order. */
export async function runConcurrently<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
}
