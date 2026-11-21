import { bumpSoupEntityTouchedAt } from './operations';

/**
 * How long a document can sit unedited before the next edit starts a new
 * editing session. It matches the Activity consumer, which records only the
 * first edit of each session (`crates/documents`, `EDITING_IDLE`).
 */
export const EDITING_IDLE_MS = 5 * 60 * 1000;

/**
 * Stamps the viewer's own touch on the first content edit of each editing
 * session, as the server records it: the item moves to the top of Recent
 * when editing starts and stays put while the viewer keeps typing. Each edit
 * extends the session, so only an edit after `EDITING_IDLE_MS` of quiet
 * stamps again.
 */
export function createEditingSessions(stamp: (entityId: string) => void) {
  const lastEdit = new Map<string, number>();
  return (entityId: string, now = Date.now()) => {
    const previous = lastEdit.get(entityId);
    lastEdit.set(entityId, now);
    if (previous !== undefined && now - previous < EDITING_IDLE_MS) return;
    stamp(entityId);
  };
}

/** Records one of the viewer's own content edits to a document. */
export const recordOwnContentEdit = createEditingSessions((entityId) => {
  bumpSoupEntityTouchedAt(entityId);
});
