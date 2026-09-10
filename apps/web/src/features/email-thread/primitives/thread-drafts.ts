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
  // keyed by the replied-to message id. A cached snapshot populates this the
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
        new Date(nextDraft.updated_at).getTime() <
          new Date(prevDraft.updated_at).getTime()
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
    Record<string, true>
  >({});

  const deleteDraftForMessage = (messageId: string) => {
    setDeletedDraftIds(messageId, true);
  };

  const getDraftForMessage = (messageId: string) => {
    if (deletedDraftIds[messageId]) return undefined;
    return serverDrafts()?.map[messageId];
  };

  // Drafts derive straight from the query, so "settled" is simply "we have a
  // thread snapshot" — cached or fresh, revalidating or not.
  const initialDraftsSettled = () => serverDrafts() !== undefined;

  return { getDraftForMessage, deleteDraftForMessage, initialDraftsSettled };
}
