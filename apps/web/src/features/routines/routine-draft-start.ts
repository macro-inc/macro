import type { ScheduleDraft } from './core/draft';
import { saveRoutineComposerDraft } from './draft-storage';

/** Tells an open new routine's page that a newer start replaced its draft. */
const ROUTINE_DRAFT_STARTED = 'macro:routine-draft-started';

/**
 * Stores a new routine's first draft for its page, which reads it on open,
 * and starts an already open page over from it.
 */
export function startRoutineDraft(draft: ScheduleDraft) {
  saveRoutineComposerDraft(draft);
  window.dispatchEvent(
    new CustomEvent<ScheduleDraft>(ROUTINE_DRAFT_STARTED, { detail: draft })
  );
}

/** Calls `restart` with each newly started draft; returns the unsubscribe. */
export function onRoutineDraftStarted(
  restart: (draft: ScheduleDraft) => void
): () => void {
  const listener = (event: Event) =>
    restart((event as CustomEvent<ScheduleDraft>).detail);
  window.addEventListener(ROUTINE_DRAFT_STARTED, listener);
  return () => window.removeEventListener(ROUTINE_DRAFT_STARTED, listener);
}
