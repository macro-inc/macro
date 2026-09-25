import { v7 as uuidv7 } from 'uuid';
import {
  type DeleteEmailDraft,
  DraftPersistRejected,
  type DraftSaveResult,
  type EmailComposeFeedback,
  type EmailDraftStorage,
} from '../context/compose-capabilities';
import type { EmailDraft } from '../core/email-draft';
import type { DraftSession } from './draft-session';

/** Sent from another device: the server outcome supersedes the local draft. */
export const isAlreadySentRejection = (error: unknown) =>
  error instanceof DraftPersistRejected && error.code === 'DRAFT_ALREADY_SENT';

/**
 * A discard's delete. An already-sent verdict is not a failure: the reset
 * the caller performs next is exactly what that verdict asks for, so it is
 * announced and swallowed. Every other rejection propagates.
 */
export async function deleteDraftForDiscard(
  drafts: Pick<EmailDraftStorage, 'deleteDraft'>,
  input: DeleteEmailDraft,
  notices: Pick<EmailComposeFeedback, 'feedback'>,
  alreadySentMessage: string
): Promise<void> {
  try {
    await drafts.deleteDraft(input);
  } catch (error) {
    if (!isAlreadySentRejection(error)) throw error;
    notices.feedback.alert(alreadySentMessage);
  }
}

/**
 * One draft's save/delete workflow against its session, shared by the reply
 * and standalone controllers.
 *
 * Identity is local-first: handles are minted before the first dispatch so
 * every queued save of a draft resolves to one server row, even when the
 * responses arrive after an app restart. Only server-confirmed ids travel in
 * the draft; minted handles go apart because a REST save cannot resolve
 * them. An outcome that lands after the composer reset (send, discard, an
 * already-sent verdict on another save) belongs to a draft the user already
 * dropped and is ignored: adopting its ids or uploading against it — the
 * upload reads the live form, which may already hold the next draft's files
 * — would re-plant that draft into the fresh composer.
 */
export function createDraftPersistence(options: {
  session: DraftSession;
  drafts: Pick<EmailDraftStorage, 'saveDraft' | 'deleteDraft'>;
  attachments: {
    upload(
      draftId: string,
      inbox: { inboxId: string | undefined }
    ): Promise<void>;
  };
  /** A standalone compose mints its thread handle too; a reply saves into a known thread. */
  mintThreadHandle: boolean;
  onAlreadySent(): void;
}) {
  const { session } = options;

  // The session records deterministic rejections (latch, or drop on
  // already-sent); transport failures just reject and the next save may retry.
  const recordRejection = (error: unknown, epoch: number) => {
    if (!(error instanceof DraftPersistRejected) || session.isStale(epoch))
      return;
    session.dispatch({ type: 'rejected', epoch, code: error.code });
    if (error.code === 'DRAFT_ALREADY_SENT') options.onAlreadySent();
  };

  return {
    /** The draft has no content left: delete its row and drop its identity. */
    async remove(input: { inboxId?: string; completingThread?: boolean }) {
      const draftId = session.draftId();
      const epoch = session.epoch();
      if (draftId) {
        try {
          await options.drafts.deleteDraft({
            draftId,
            threadId: session.threadId(),
            ...input,
          });
        } catch (error) {
          recordRejection(error, epoch);
          throw error;
        }
      }
      if (session.isStale(epoch)) return;
      session.dispatch({ type: 'emptied' });
    },

    /**
     * Saves the draft and its local attachments. Resolves with the result,
     * or undefined when nothing was adopted: autosave is latched, or the
     * composer was reset while the save was on the wire.
     */
    async save(input: {
      draft: EmailDraft;
      inboxId?: string;
      completingThread?: boolean;
    }): Promise<DraftSaveResult | undefined> {
      // Latched: the content stays in the editor, but a rejected save must
      // never replay on its own — a doomed save would block the queue.
      if (!session.autosaveAllowed()) return;
      const previousThreadId = session.threadId();
      if (!session.draftId()) {
        session.dispatch({
          type: 'minted',
          draftId: uuidv7(),
          threadId: options.mintThreadHandle
            ? uuidv7()
            : (input.draft.thread_db_id ?? undefined),
        });
      }
      const identity = session.identity();
      const epoch = session.epoch();
      const confirmed = identity.kind === 'server' ? identity : undefined;
      let saved: DraftSaveResult;
      try {
        saved = await options.drafts.saveDraft({
          draft: {
            ...input.draft,
            db_id: confirmed?.draftId,
            thread_db_id: input.draft.thread_db_id ?? confirmed?.threadId,
          },
          clientHandles:
            identity.kind === 'handle'
              ? { draftId: identity.draftId, threadId: identity.threadId }
              : undefined,
          inboxId: input.inboxId,
          completingThread: input.completingThread,
          previousThreadId,
        });
      } catch (error) {
        recordRejection(error, epoch);
        throw error;
      }
      if (session.isStale(epoch)) return;
      session.dispatch({ type: 'saved', epoch, identity: saved });
      if (!saved.draftId) return;
      const inbox = { inboxId: saved.inboxId };
      if (saved.persistence === 'queued') {
        // REST cannot resolve client handles. Keep local files for the next
        // committed save, which also waits for all uploads before sending.
        return saved;
      }
      await options.attachments.upload(saved.draftId, inbox);
      if (session.isStale(epoch)) return;
      return saved;
    },

    /** The id REST-only follow-ups (scheduling) may use after a save, else undefined. */
    confirmed: (draftId: string | undefined) =>
      session.serverConfirmed() && session.autosaveAllowed()
        ? draftId
        : undefined,
  };
}
