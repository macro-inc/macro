import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import type {
  EmailComposeFeedback,
  EmailDraftStorage,
} from '../context/compose-capabilities';
import type { DraftSession } from './draft-session';

/** Refresh identity only: a cache settlement must never reseed a dirty editor. */
export function observeDraftIdentity(
  storage: EmailDraftStorage,
  session: DraftSession,
  notices: Pick<EmailComposeFeedback, 'feedback' | 'reportError'>,
  recover: () => void,
  onAlreadySent: () => void
) {
  createEffect(
    on(
      () => [storage.readDraft, storage.watchDrafts] as const,
      ([read, watch]) => {
        if (read && watch)
          observeAvailableDraftIdentity(
            read,
            watch,
            session,
            notices,
            recover,
            onAlreadySent,
            !!storage.retryDraft
          );
      }
    )
  );
}

function observeAvailableDraftIdentity(
  read: NonNullable<EmailDraftStorage['readDraft']>,
  watch: NonNullable<EmailDraftStorage['watchDrafts']>,
  session: DraftSession,
  notices: Pick<EmailComposeFeedback, 'feedback' | 'reportError'>,
  recover: () => void,
  onAlreadySent: () => void,
  durableRecovery: boolean
) {
  let generation = 0;
  let mutationUuid: string | undefined;
  let disposed = false;
  let rejectionNotice: number | undefined;
  const dismissRejectionNotice = () => {
    if (rejectionNotice === undefined) return;
    notices.feedback.dismiss(rejectionNotice);
    rejectionNotice = undefined;
  };
  let lastRefresh: Promise<void> = Promise.resolve();
  const refresh = () => (lastRefresh = readIdentity());
  const readIdentity = async () => {
    const draftId = session.draftId();
    if (!draftId) return;
    const epoch = session.epoch();
    const request = ++generation;
    try {
      const result = await read(draftId, { attachments: false });
      if (
        !result ||
        disposed ||
        request !== generation ||
        session.isStale(epoch) ||
        session.draftId() !== draftId
      )
        return;
      mutationUuid = result.mutationUuid ?? mutationUuid;
      if (
        result.local &&
        ['failed', 'unconfirmed', 'delete-failed'].includes(result.local.status)
      ) {
        session.dispatch({ type: 'rejected', epoch, code: 'INTERNAL' });
      }
      if (!result.draft) return;
      const current = session.identity();
      if (
        current.kind !== 'none' &&
        current.draftId === result.draft.db_id &&
        current.threadId === result.draft.thread_db_id &&
        current.queued === (result.persistence === 'queued') &&
        (result.persistence === 'queued' ||
          current.inboxId === result.draft.link_id)
      )
        return;
      session.dispatch({
        type: 'saved',
        epoch,
        identity: {
          draftId: result.draft.db_id,
          threadId: result.draft.thread_db_id,
          inboxId: result.draft.link_id,
          persistence: result.persistence,
        },
      });
    } catch (error) {
      notices.reportError(error);
    }
  };
  const rejected = async (settlement: { mutationUuid?: string }) => {
    // An adopted draft coalesces under its original handle, which only the
    // first read reveals; a failure racing that read must wait for it.
    const epoch = session.epoch();
    while (mutationUuid === undefined) {
      const pending = lastRefresh;
      await pending;
      if (disposed || session.isStale(epoch)) return false;
      // A cache notification can replace an in-flight read. Its discarded
      // result cannot identify this draft, so wait for the replacement too.
      if (pending === lastRefresh) break;
    }
    if (disposed || session.isStale(epoch)) return false;
    return settlement.mutationUuid === (mutationUuid ?? session.draftId());
  };
  const unsubscribe = watch((settlement) => {
    const epoch = session.epoch();
    void (async () => {
      if (
        settlement?.failed &&
        settlement.mutationUuid &&
        (await rejected(settlement))
      ) {
        if (disposed || session.isStale(epoch) || !session.draftId()) return;
        const code = settlement.code ?? 'INTERNAL';
        if (code !== 'DRAFT_ALREADY_SENT' && !session.autosaveAllowed()) return;
        session.dispatch({ type: 'rejected', epoch, code });
        if (code === 'DRAFT_ALREADY_SENT') {
          dismissRejectionNotice();
          onAlreadySent();
          return;
        }
        notices.reportError(
          new Error('The server rejected the queued draft save')
        );
        rejectionNotice = notices.feedback.failure('Draft could not be saved', {
          subtext: durableRecovery
            ? 'Your edits are saved on this device. Retry to save them to the server.'
            : 'Your edits are still in this editor. Save them as a new draft before closing.',
          persistent: true,
          actions: [
            {
              label: durableRecovery ? 'Retry' : 'Save as new draft',
              onClick: () => {
                if (
                  disposed ||
                  session.isStale(epoch) ||
                  session.autosaveAllowed()
                )
                  return;
                recover();
              },
            },
          ],
        });
        return;
      }
      if (disposed || session.isStale(epoch)) return;
      await refresh();
    })();
  });
  // Session accessors read the whole state signal. Compare their values so
  // unrelated updates do not dismiss rejection notices or reread storage.
  const epoch = createMemo(session.epoch);
  const draftId = createMemo(session.draftId);

  createEffect(
    on(epoch, () => {
      mutationUuid = undefined;
      dismissRejectionNotice();
    })
  );
  createEffect(
    on(draftId, () => {
      void refresh();
    })
  );
  onCleanup(() => {
    disposed = true;
    dismissRejectionNotice();
    unsubscribe();
  });
}
