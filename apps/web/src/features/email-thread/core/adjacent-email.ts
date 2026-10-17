/** Where an email sat among the list's emails, nearest neighbours first. */
export type EmailPosition = {
  id: string;
  next: string[];
  previous: string[];
};

function uniqueEmails<T extends { id: string; type: string }>(
  entities: readonly T[]
): T[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (entity.type !== 'email' || seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

/** The email's current position, or undefined when it is not in the list. */
export function emailPosition<T extends { id: string; type: string }>(
  entities: readonly T[],
  currentId: string
): EmailPosition | undefined {
  const ids = uniqueEmails(entities).map((entity) => entity.id);
  const index = ids.indexOf(currentId);
  if (index < 0) return undefined;
  return {
    id: currentId,
    next: ids.slice(index + 1),
    previous: ids.slice(0, index).reverse(),
  };
}

/**
 * Find a neighboring thread in list order, skipping non-email rows and
 * duplicates. Once the current thread has left the list (a reply marked it
 * done), `former` places it between its surviving former neighbours.
 */
export function adjacentEmail<T extends { id: string; type: string }>(
  entities: readonly T[],
  currentId: string,
  direction: -1 | 1,
  former?: EmailPosition
): T | undefined {
  const emails = uniqueEmails(entities);
  const index = emails.findIndex((entity) => entity.id === currentId);
  if (index >= 0) return emails[index + direction];
  if (former?.id !== currentId) return undefined;

  const indexById = new Map(emails.map((entity, i) => [entity.id, i]));
  const survivor = (ids: string[]) =>
    ids.map((id) => indexById.get(id)).find((i) => i !== undefined);
  const after = survivor(former.next);
  if (after !== undefined) return emails[direction === 1 ? after : after - 1];
  const before = survivor(former.previous);
  if (before !== undefined)
    return emails[direction === 1 ? before + 1 : before];
  return undefined;
}
