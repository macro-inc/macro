import {
  type ContactRepresentative,
  deduplicatePeople,
  interactionTime,
} from './people';

type DiscoveredContact = ContactRepresentative & { name?: string | null };

/** Server pages carry the freshest facts for a record the cache also holds;
 * one visible record per email remains, most recent interaction first. */
export function mergeDiscoveredContacts<T extends DiscoveredContact>(
  cached: readonly T[],
  server: readonly T[]
): T[] {
  const byId = new Map<string, T>();
  for (const contact of cached) byId.set(contact.id, contact);
  for (const contact of server) byId.set(contact.id, contact);
  return deduplicatePeople([...byId.values()]).sort(
    (left, right) =>
      interactionTime(right) - interactionTime(left) ||
      (right.id > left.id ? 1 : right.id < left.id ? -1 : 0)
  );
}
