import { getUploadFileSize } from '@core/mobile/nativeStagedUpload';
import { createSignal } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import {
  DraftTransferAborted,
  type EmailDraftStorage,
  type EmailInbox,
} from '../context/compose-capabilities';
import { attachmentLimitBytes } from '../core/constants';
import type { DraftSession } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';

/** Preserve the operation ID across a lost response and adopt a distinct identity. */
export function createDraftTransfer(options: {
  session: DraftSession;
  drafts: Pick<EmailDraftStorage, 'transferDraft'>;
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
    async move(destination: EmailInbox, sourceInboxId: string) {
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
    },
  };
}
