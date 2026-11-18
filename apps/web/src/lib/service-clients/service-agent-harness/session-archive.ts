import type { ArchiveCause } from './generated/schemas';

/** False for a session that has not loaded. */
export function isSessionArchived(
  session: { archivedBy?: ArchiveCause | null } | undefined
): boolean {
  return session?.archivedBy != null;
}
