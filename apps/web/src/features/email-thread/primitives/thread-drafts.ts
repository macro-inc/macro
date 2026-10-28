import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { EmailMessage } from '../../email-message/core/email-message';

/** Reconcile server snapshots with newer local knowledge and discarded drafts. */
export function createThreadDrafts(
  source: Accessor<
    | {
        db_id: string;
        draftMap: Record<string, EmailMessage>;
      }
    | undefined
  >
) {
  // The newest version of each reply draft seen across query snapshots,
  // keyed by the replied-to message id. A server identity replacing a client
  // handle wins regardless of timestamp: client and server clocks can differ. A cached snapshot populates this the
  // moment it's available (the composer must not wait on the network), and a
  // later fetch upgrades an entry only when its updated_at is newer — so the
  // revalidation of a stale cache wins, but an out-of-order response can't
  // downgrade a draft. Entries missing from a fetch are kept: deletes are
  // handled locally below, and dropping one would collapse an open composer.
  const serverDrafts = createMemo<
    { threadDbId: string; map: Record<string, EmailMessage> } | undefined
  >((prev) => {
    const data = source();
    if (!data) return undefined;
    const next = data.draftMap;
    if (!prev || prev.threadDbId !== data.db_id) {
      return { threadDbId: data.db_id, map: next };
    }
    const map: Record<string, EmailMessage> = { ...next };
    for (const [messageId, prevDraft] of Object.entries(prev.map)) {
      const nextDraft = map[messageId];
      if (
        !nextDraft ||
        (nextDraft.db_id === prevDraft.db_id &&
          new Date(nextDraft.updated_at).getTime() <
            new Date(prevDraft.updated_at).getTime())
      ) {
        map[messageId] = prevDraft;
      }
    }
    return { threadDbId: data.db_id, map };
  });

  // Drafts the user discarded this session. Kept apart from the server map so
  // a fetch that still contains the deleted draft (delete propagation lag)
  // can't resurrect it.
  const [deletedDraftIds, setDeletedDraftIds] = createStore<
    Record<string, true | undefined>
  >({});
  const [restoredDrafts, setRestoredDrafts] = createStore<
    Record<
      string,
      { draft: EmailMessage; sourceDraftId: string | undefined } | undefined
    >
  >({});

  const deleteDraftForMessage = (messageId: string) => {
    setDeletedDraftIds(messageId, true);
    setRestoredDrafts(messageId, undefined);
  };

  const restoreDraftForMessage = (draft: EmailMessage) => {
    if (!draft.replying_to_id || draft.thread_db_id !== source()?.db_id) return;
    setRestoredDrafts(draft.replying_to_id, {
      draft,
      sourceDraftId: serverDrafts()?.map[draft.replying_to_id]?.db_id,
    });
    setDeletedDraftIds(draft.replying_to_id, undefined);
  };

  const getDraftForMessage = (messageId: string) => {
    if (deletedDraftIds[messageId]) return undefined;
    const current = serverDrafts()?.map[messageId];
    const restoration = restoredDrafts[messageId];
    if (!restoration || restoration.draft.thread_db_id !== source()?.db_id)
      return current;
    const restored = restoration.draft;
    // Keep the pre-restoration source behind the explicit snapshot, but adopt a
    // subsequent canonical identity even when the client's clock is ahead.
    return current &&
      (current.db_id !== restoration.sourceDraftId ||
        (current.db_id === restored.db_id &&
          new Date(current.updated_at) >= new Date(restored.updated_at)))
      ? current
      : restored;
  };

  // Drafts derive straight from the query, so "settled" is simply "we have a
  // thread snapshot" — cached or fresh, revalidating or not.
  const initialDraftsSettled = () => serverDrafts() !== undefined;

  return {
    getDraftForMessage,
    deleteDraftForMessage,
    restoreDraftForMessage,
    initialDraftsSettled,
  };
}
