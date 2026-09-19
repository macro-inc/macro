/** Find a neighboring thread in list order, skipping non-email rows and duplicates. */
export function adjacentEmail<T extends { id: string; type: string }>(
  entities: readonly T[],
  currentId: string,
  direction: -1 | 1
): T | undefined {
  const seen = new Set<string>();
  const emails = entities.filter((entity) => {
    if (entity.type !== 'email' || seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
  const index = emails.findIndex((entity) => entity.id === currentId);
  return index < 0 ? undefined : emails[index + direction];
}
