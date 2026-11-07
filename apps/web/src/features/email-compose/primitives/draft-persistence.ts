import { Telemetry } from '@macro-inc/observability';
import { v7 as uuidv7 } from 'uuid';
import {
  type DeleteEmailDraft,
  DraftPersistRejected,
  type DraftSaveResult,
  type EmailDraftStorage,
  type SentWorkingCopy,
} from '../context/compose-capabilities';
import type { EmailDraft } from '../core/email-draft';
import type { LocalDraft } from '../core/local-draft';
import type { DraftSession } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';

export type DraftPersistence = ReturnType<typeof createDraftPersistence>;

/** Sent from another device: the server outcome supersedes the local draft. */
export const isAlreadySentRejection = (error: unknown) =>
  error instanceof DraftPersistRejected && error.code === 'DRAFT_ALREADY_SENT';

/** Why a composer moved its text to a new draft instead of the one it edited. */
export type KeptAsNewDraftReason =
  | 'save-rejected'
  | 'scheduled-elsewhere'
  | 'sent-elsewhere'
  | 'changed-elsewhere';

/**
 * A new draft beside a delivered one reads as a duplicate of the sent email,
 * so every such move is recorded. Identity and counts only, never content.
 */
export function recordKeptAsNewDraft(
  reason: KeptAsNewDraftReason,
  draft: { draftId: string | undefined; unsavedEdits: number }
): void {
  Telemetry.warn('email_draft.kept_as_new', {
    'email_draft.reason': reason,
    'email_draft.draft_id': draft.draftId,
    'email_draft.unsaved_edits': draft.unsavedEdits,
  });
}

/**
 * A discard's delete. An already-sent verdict is not a failure: the reset
 * the caller performs next is exactly what that verdict asks for, so it is
 * swallowed. Every other rejection propagates.
 */
export async function deleteDraftForDiscard(
  drafts: Pick<EmailDraftStorage, 'deleteDraft'>,
  input: DeleteEmailDraft
): Promise<void> {
  try {
    await drafts.deleteDraft(input);
  } catch (error) {
    if (!isAlreadySentRejection(error)) throw error;
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
  draftGeneration?: () => number;
  drafts: Pick<
    EmailDraftStorage,
    'saveDraft' | 'deleteDraft' | 'saveLocalDraft' | 'retryDraft' | 'readDraft'
  >;
  attachments: {
    upload(
      draftId: string,
      inbox: { inboxId: string | undefined }
    ): Promise<void>;
  };
  /** A standalone compose mints its thread handle too; a reply saves into a known thread. */
  mintThreadHandle: boolean;
  localDraft?: Pick<LocalDraft, 'revision' | 'generation'>;
  onAlreadySent(): void;
}) {
  const { session } = options;
  let localRevision = options.localDraft?.revision;
  let localGeneration = options.localDraft?.generation;
  // Edits are counted by the caller. The newest local write records which edit
  // its working-copy revision holds, so a server acknowledgement or a send of
  // that revision can tell which edits it carried.
  let lastLocalEdit:
    | { edit: number; generation: string; revision: number }
    | undefined;
  // The newest edit a committed save put on the server.
  let savedEdit = 0;
  let removal: Promise<void> = Promise.resolve();
  const mint = (draft: EmailDraft) => {
    if (session.draftId()) return;
    localRevision = undefined;
    localGeneration = undefined;
    lastLocalEdit = undefined;
    savedEdit = 0;
    session.dispatch({
      type: 'minted',
      draftId: uuidv7(),
      threadId: options.mintThreadHandle
        ? uuidv7()
        : (draft.thread_db_id ?? undefined),
    });
  };

  // The session records deterministic rejections (latch, or drop on
  // already-sent); transport failures just reject and the next save may retry.
  const recordRejection = (error: unknown, epoch: number) => {
    if (!(error instanceof DraftPersistRejected) || session.isStale(epoch))
      return;
    session.dispatch({ type: 'rejected', epoch, code: error.code });
    if (error.code === 'DRAFT_ALREADY_SENT') options.onAlreadySent();
  };

  return {
    localVersion(): Pick<LocalDraft, 'generation' | 'revision'> | undefined {
      return localGeneration !== undefined && localRevision !== undefined
        ? { generation: localGeneration, revision: localRevision }
        : undefined;
    },
    /**
     * The composer replaced its content with a restored draft as of `content`'s
     * edit, or (without `content`) moved to a draft with no working copy.
     */
    restored(
      local: Pick<LocalDraft, 'revision' | 'generation'> | undefined,
      content?: { edit: number; persistence: 'committed' | 'queued' }
    ) {
      localRevision = local?.revision;
      localGeneration = local?.generation;
      lastLocalEdit =
        local && content
          ? {
              edit: content.edit,
              generation: local.generation,
              revision: local.revision,
            }
          : undefined;
      if (content?.persistence === 'committed') savedEdit = content.edit;
    },
    /** A save resolved as committed, or a delete completed, as of `edit`. */
    saved(edit: number) {
      savedEdit = Math.max(savedEdit, edit);
    },
    /**
     * The server acknowledged the working copy. A save that rode the offline
     * queue commits after its call returned, so this is how its edits count.
     */
    acknowledged(
      local: Pick<LocalDraft, 'generation' | 'acknowledgedRevision'>
    ) {
      if (!lastLocalEdit) return;
      if (local.generation !== lastLocalEdit.generation) return;
      if (local.acknowledgedRevision < lastLocalEdit.revision) return;
      savedEdit = Math.max(savedEdit, lastLocalEdit.edit);
    },
    /**
     * How many edits up to `edit` no committed save holds and no send from
     * this browser carried: the text that dropping the draft would lose. A
     * send locks the working copy it captures, so it carries every edit this
     * composer wrote to that generation.
     */
    unsavedEdits(edit: number, sentCopy?: SentWorkingCopy): number {
      const sent =
        sentCopy &&
        lastLocalEdit?.generation === sentCopy.generation &&
        lastLocalEdit.revision <= sentCopy.revision
          ? lastLocalEdit.edit
          : 0;
      return Math.max(0, edit - Math.max(savedEdit, sent));
    },
    async saveLocally(input: {
      draft: EmailDraft | null;
      inboxId?: string;
      attachments: readonly DraftFormAttachment[];
      /** The caller's edit counter for this snapshot. */
      edit: number;
    }) {
      if (!options.drafts.saveLocalDraft) return;
      // The copy being deleted refuses edits. Address the draft the delete
      // leaves: a fresh one, or the same one when the delete failed.
      await removal;
      // Preserve an emptied working copy too; a failed delete must not restore
      // the earlier body on reload. An untouched composer has no identity.
      if (!input.draft && !session.draftId()) return;
      const draft = input.draft ?? {
        subject: '',
        to: [],
        cc: [],
        bcc: [],
        body_html: '',
      };
      mint(draft);
      const identity = session.identity();
      if (identity.kind === 'none') return;
      const epoch = session.epoch();
      const local = await options.drafts.saveLocalDraft({
        // A composer that opened no working copy expects none: overwriting one
        // another composer wrote would drop text it never saw.
        expectedRevision: localRevision ?? 0,
        expectedGeneration: localGeneration,
        draft: {
          ...draft,
          db_id: identity.kind === 'server' ? identity.draftId : undefined,
        },
        clientHandles:
          identity.kind === 'handle'
            ? { draftId: identity.draftId, threadId: identity.threadId }
            : undefined,
        inboxId: input.inboxId,
        attachments: input.attachments,
      });
      if (!session.isStale(epoch)) {
        localRevision = local.revision;
        localGeneration = local.generation;
        lastLocalEdit = {
          edit: input.edit,
          generation: local.generation,
          revision: local.revision,
        };
      }
    },
    async retry() {
      const id = session.draftId();
      if (!id || !options.drafts.retryDraft) return;
      const latest = await options.drafts.readDraft?.(id, {
        attachments: false,
      });
      if (
        latest?.local &&
        (latest.local.revision !== localRevision ||
          latest.local.generation !== localGeneration)
      ) {
        throw new Error(
          'This draft changed in another tab. Reopen it to retry the latest version.'
        );
      }
      await options.drafts.retryDraft(id);
      session.dispatch({ type: 'retry' });
    },
    /** The draft has no content left: delete its row and drop its identity. */
    async remove(input: { inboxId?: string; completingThread?: boolean }) {
      let removed!: () => void;
      removal = new Promise<void>((resolve) => {
        removed = resolve;
      });
      try {
        const draftId = session.draftId();
        const epoch = session.epoch();
        if (draftId) {
          try {
            await options.drafts.deleteDraft({
              draftId,
              draftGeneration: options.draftGeneration?.() ?? 0,
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
      } finally {
        removed();
      }
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
      mint(input.draft);
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
