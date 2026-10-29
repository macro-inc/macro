import { getUploadFileSize } from '@core/mobile/nativeStagedUpload';
import { fireAndForget } from '@core/util/fireAndForget';
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
  return {
    pending,
    /** Resolves with the moved draft's ids once the server commits the move. */
    async move(
      destination: EmailInbox,
      sourceInboxId: string
    ): Promise<{ draftId: string; threadId: string } | undefined> {
      const pendingMove = pending();
      if (pendingMove && pendingMove.destinationInboxId !== destination.id) {
        throw new Error(
          'Retry the previous inbox change before choosing another inbox.'
        );
      }
      if (!pendingMove) {
        const size = options.attachments
          .list()
          .reduce(
            (sum, a) =>
              sum +
              (a.type === 'local' ? getUploadFileSize(a.file) : a.fileSize),
            0
          );
        if (size > attachmentLimitBytes(destination.provider))
          throw new Error(
            'These attachments exceed the destination inbox’s size limit.'
          );
        await options.save();
        const draftId = options.session.draftId();
        if (!draftId) return;
        if (!options.session.serverConfirmed())
          throw new Error(
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
      let result;
      try {
        result = await options.drafts.transferDraft(request);
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
    },
  };
}
