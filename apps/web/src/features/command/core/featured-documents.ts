// Quick Access buckets whose rows are cached Soup document records.
const DOCUMENT_BUCKETS = new Set<string>([
  'document',
  'note',
  'task',
  'snippet',
  'skill',
]);
/** How many of a typed query's first document rows are checked on the server. */
const VERIFIED_DOCUMENT_COUNT = 3;

/**
 * The ids of the first few documents a typed query lists, which the menu
 * checks on the server: Quick Access matches names in the cache alone, so a
 * document gone on the server would otherwise stay listed.
 */
export function featuredCommandDocumentIds(
  items: readonly { bucket?: string; id?: string }[],
  query: string
): string[] {
  if (!query.trim()) return [];
  const ids: string[] = [];
  for (const item of items) {
    if (ids.length === VERIFIED_DOCUMENT_COUNT) break;
    if (item.id && item.bucket && DOCUMENT_BUCKETS.has(item.bucket))
      ids.push(item.id);
  }
  return ids;
}
