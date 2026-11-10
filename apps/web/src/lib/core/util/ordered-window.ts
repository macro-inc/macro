/** Keep other sources in their existing slots, but never filter or reorder an
 * already-matched bounded window. Its missing tail remains reachable. */
export function preserveOrderedWindow<T>(
  ranked: readonly T[],
  ordered: readonly T[],
  key: (item: T) => string
): T[] {
  const identities = new Set(ordered.map(key));
  let index = 0;
  const result = ranked.map((item) =>
    identities.has(key(item)) ? ordered[index++] : item
  );
  return [...result, ...ordered.slice(index)];
}

/** A position belongs only to the current personal window, not query history. */
export function preservePersonOrder<
  T extends { id: string; personOrder?: number },
>(ranked: readonly T[], items: readonly T[]): T[] {
  const ordered = items
    .flatMap((item) =>
      item.personOrder === undefined ? [] : [{ item, order: item.personOrder }]
    )
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);
  return preserveOrderedWindow(ranked, ordered, (item) => item.id);
}
