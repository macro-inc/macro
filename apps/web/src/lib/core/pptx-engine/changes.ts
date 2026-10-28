/**
 * Announcements that a presentation's stored file changed outside its open
 * editor (an AI edit, for example), so an open editor can load the new version.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/** Tells open editors of `documentId` that a newer version was saved elsewhere. */
export function announcePresentationChanged(documentId: string): void {
  for (const listener of listeners.get(documentId) ?? []) listener();
}

/** Calls `listener` on each announcement for `documentId`; returns an unsubscribe. */
export function watchPresentationChanges(
  documentId: string,
  listener: Listener
): () => void {
  const set = listeners.get(documentId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(documentId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(documentId);
  };
}
