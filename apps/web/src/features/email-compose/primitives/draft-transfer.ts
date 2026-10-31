import { getUploadFileSize } from '@core/mobile/nativeStagedUpload';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  DraftTransferAborted,
  type EmailDraftStorage,
  type EmailInbox,
} from '../context/compose-capabilities';
import { attachmentLimitBytes } from '../core/constants';
import type { DraftPersistence } from './draft-persistence';
import type { DraftSession } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';

class DraftTransferRejected extends Error {
  constructor(
    readonly reason:
      | 'pending_other_inbox'
      | 'attachment_limit'
      | 'unconfirmed_draft',
    message: string
  ) {
    super(message);
  }
}

/** Preserve the operation ID across a lost response and adopt a distinct identity. */
export function createDraftTransfer(options: {
  session: DraftSession;
  persistence: Pick<DraftPersistence, 'restored'>;
  draftGeneration?: () => number;
  onTransferred?: () => void;
  drafts: Pick<EmailDraftStorage, 'transferDraft' | 'forgetLocalDraft'>;
  attachments: {
    list(): DraftFormAttachment[];
    replace(files: DraftFormAttachment[]): void;
  };
  save(): Promise<unknown>;
  invalidateOldSaves(): void;
}) {
  const [pending, setPending] =
    createSignal<Parameters<EmailDraftStorage['transferDraft']>[0]>();
  const transfer = async (
    span: Span,
    destination: EmailInbox,
    sourceInboxId: string
  ) => {
    const pendingMove = pending();
    if (pendingMove && pendingMove.destinationInboxId !== destination.id) {
      throw new DraftTransferRejected(
        'pending_other_inbox',
        'Retry the previous inbox change before choosing another inbox.'
      );
    }
    if (!pendingMove) {
      const size = options.attachments
        .list()
        .reduce(
          (sum, a) =>
            sum + (a.type === 'local' ? getUploadFileSize(a.file) : a.fileSize),
          0
        );
      if (size > attachmentLimitBytes(destination.provider))
        throw new DraftTransferRejected(
          'attachment_limit',
          'These attachments exceed the destination inbox’s size limit.'
        );
      await span.span('email.draft_transfer.save', async (save) => {
        try {
          await options.save();
        } catch (error) {
          save.error('Draft save failed');
          throw error;
        }
      });
      const draftId = options.session.draftId();
      if (!draftId) return;
      if (!options.session.serverConfirmed())
        throw new DraftTransferRejected(
          'unconfirmed_draft',
          'Reconnect and let the draft finish saving before changing inboxes.'
        );
      setPending({
        operationId: uuidv7(),
        draftGeneration: options.draftGeneration?.(),
        draftId,
        sourceInboxId,
        destinationInboxId: destination.id,
      });
    }
    const request = pending();
    if (!request) return;
    span.setAttr('email.draft_transfer.draft_id', request.draftId);
    span.setAttr('email.draft_transfer.operation_id', request.operationId);
    let result;
    try {
      // Native awaits drop the active span, so the request joins this trace
      // explicitly.
      result = await span.run(() => options.drafts.transferDraft(request));
    } catch (error) {
      if (error instanceof DraftTransferAborted) setPending(undefined);
      throw error;
    }
    options.invalidateOldSaves();
    options.onTransferred?.();
    // The moved draft has no working copy yet, and the source's copy would
    // linger as a draft whose server row is gone.
    options.persistence.restored(undefined);
    const forget = options.drafts.forgetLocalDraft?.(request.draftId);
    if (forget) fireAndForget(forget, 'email-compose');
    options.session.dispatch({
      type: 'seeded',
      draftId: result.draftId,
      threadId: result.threadId,
      inboxId: destination.id,
    });
    options.attachments.replace(
      result.attachments.map((a) => ({
        type: 'remote',
        attachmentId: a.id,
        fileName: a.file_name,
        contentType: a.content_type,
        fileSize: a.size,
        url: a.s3_key,
        uploadPending: a.upload_pending,
      }))
    );
    setPending(undefined);
    return { draftId: result.draftId, threadId: result.threadId };
  };
  return {
    pending,
    /** Resolves with the moved draft's ids once the server commits the move. */
    move(
      destination: EmailInbox,
      sourceInboxId: string
    ): Promise<{ draftId: string; threadId: string } | undefined> {
      return Telemetry.span('email.draft_transfer', async (span) => {
        span.setAttr('email.draft_transfer.source_inbox_id', sourceInboxId);
        span.setAttr(
          'email.draft_transfer.destination_inbox_id',
          destination.id
        );
        if (destination.provider)
          span.setAttr(
            'email.draft_transfer.destination_provider',
            destination.provider
          );
        span.setAttr(
          'email.draft_transfer.attachment_count',
          options.attachments.list().length
        );
        span.setAttr('email.draft_transfer.retry', pending() !== undefined);
        try {
          const moved = await transfer(span, destination, sourceInboxId);
          span.setAttr(
            'email.draft_transfer.outcome',
            moved ? 'moved' : 'skipped'
          );
          return moved;
        } catch (error) {
          if (error instanceof DraftTransferRejected) {
            span.setAttr('email.draft_transfer.outcome', 'rejected');
            span.setAttr('email.draft_transfer.rejection', error.reason);
          } else {
            const outcome =
              error instanceof DraftTransferAborted ? 'aborted' : 'failed';
            span.setAttr('email.draft_transfer.outcome', outcome);
            span.error(`Draft transfer ${outcome}`);
          }
          throw error;
        }
      });
    },
  };
}
