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
    // A repeated identity has no window row left to take; keep the ranked one.
    identities.has(key(item)) ? (ordered[index++] ?? item) : item
  );
  return [...result, ...ordered.slice(index)];
}

/** A position belongs only to the current personal window, not query history.
 * People keep their window order among rows of the same `tier`; a person never
 * takes a slot that a better-matching person earned. Window people the ranking
 * left out follow the last listed person. */
export function preservePersonOrder<
  T extends { id: string; personOrder?: number },
>(
  ranked: readonly T[],
  items: readonly T[],
  tier: (item: T) => number = () => 0
): T[] {
  const windowed = items
    .flatMap((item) =>
      item.personOrder === undefined ? [] : [{ item, order: item.personOrder }]
    )
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);
  const windowIds = new Set(windowed.map((item) => item.id));
  const listedIds = new Set(
    ranked.flatMap((item) => (windowIds.has(item.id) ? [item.id] : []))
  );
  const queues = new Map<number, T[]>();
  for (const person of windowed) {
    if (!listedIds.has(person.id)) continue;
    const queue = queues.get(tier(person));
    if (queue) queue.push(person);
    else queues.set(tier(person), [person]);
  }
  const taken = new Map<number, number>();
  let lastSlot = -1;
  const result = ranked.map((item, index) => {
    if (!windowIds.has(item.id)) return item;
    lastSlot = index;
    const group = tier(item);
    const position = taken.get(group) ?? 0;
    taken.set(group, position + 1);
    return queues.get(group)?.[position] ?? item;
  });
  const unlisted = windowed.filter((person) => !listedIds.has(person.id));
  result.splice(lastSlot < 0 ? result.length : lastSlot + 1, 0, ...unlisted);
  return result;
}
