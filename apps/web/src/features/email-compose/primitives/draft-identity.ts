import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import type { EmailDraftStorage } from '../context/compose-capabilities';
import type { DraftSession } from './draft-session';

/** Refresh identity only: a cache settlement must never reseed a dirty editor. */
export function observeDraftIdentity(
  storage: EmailDraftStorage,
  session: DraftSession,
  reportError: (error: unknown) => void
) {
  const read = storage.readDraft;
  if (!read || !storage.watchDrafts) return;
  let generation = 0;
  let mutationUuid: string | undefined;
  let disposed = false;
  let lastRefresh: Promise<void> = Promise.resolve();
  const refresh = () => (lastRefresh = readIdentity());
  const readIdentity = async () => {
    const draftId = session.draftId();
    if (!draftId) return;
    const epoch = session.epoch();
    const request = ++generation;
    try {
      const result = await read(draftId);
      if (
        !result ||
        disposed ||
        request !== generation ||
        session.isStale(epoch) ||
        session.draftId() !== draftId
      )
        return;
      mutationUuid = result.mutationUuid ?? mutationUuid;
      const current = session.identity();
      if (
        current.kind !== 'none' &&
        current.draftId === result.draft.db_id &&
        current.threadId === result.draft.thread_db_id &&
        current.queued === (result.persistence === 'queued')
      )
        return;
      session.dispatch({
        type: 'saved',
        epoch,
        identity: {
          draftId: result.draft.db_id,
          threadId: result.draft.thread_db_id,
          persistence: result.persistence,
        },
      });
    } catch (error) {
      reportError(error);
    }
  };
  const rejected = async (settlement: { mutationUuid?: string }) => {
    // An adopted draft coalesces under its original handle, which only the
    // first read reveals; a failure racing that read must wait for it.
    if (mutationUuid === undefined) await lastRefresh;
    if (disposed) return false;
    return settlement.mutationUuid === (mutationUuid ?? session.draftId());
  };
  const unsubscribe = storage.watchDrafts((settlement) => {
    void (async () => {
      if (
        settlement?.failed &&
        settlement.mutationUuid &&
        (await rejected(settlement))
      ) {
        session.dispatch({
          type: 'rejected',
          epoch: session.epoch(),
          code: 'INTERNAL',
        });
        reportError(new Error('The server rejected the queued draft save'));
        return;
      }
      await refresh();
    })();
  });
  // `on` re-runs whenever the session state changes; the memos limit that to
  // changes of the epoch and draft id values themselves.
  createEffect(
    on(createMemo(session.epoch), () => {
      mutationUuid = undefined;
    })
  );
  createEffect(
    on(createMemo(session.draftId), () => {
      void refresh();
    })
  );
  onCleanup(() => {
    disposed = true;
    unsubscribe();
  });
}
