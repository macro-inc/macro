/** Search the visible title and supporting text of an associated record. */
export function recordItemMatchesSearch(
  entity: { name: string; snippet?: unknown; summary?: unknown },
  search: string
): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const text = [
    entity.name,
    'snippet' in entity ? entity.snippet : undefined,
    'summary' in entity ? entity.summary : undefined,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return query.split(/\s+/).every((word) => text.includes(word));
}
