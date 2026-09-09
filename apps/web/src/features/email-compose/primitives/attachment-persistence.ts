import { type Accessor, createSignal } from 'solid-js';
import type { EmailAttachmentStorage } from '../context/compose-capabilities';
import type { DraftFormAttachment } from './email-form-state';
import type { EmailFormContextValue } from './email-form-types';

type AttachmentState = Pick<
  EmailFormContextValue['attachments'],
  | 'list'
  | 'assignAttachmentId'
  | 'clearAttachmentId'
  | 'removeByFile'
  | 'removeById'
  | 'removeForwarded'
>;

/** Attachment transport and completion, independent of draft/send orchestration. */
export function createAttachmentPersistence(options: {
  attachments: AttachmentState;
  draftId: Accessor<string | null | undefined>;
  inboxId: Accessor<string | undefined>;
  services: Pick<
    EmailAttachmentStorage,
    'uploadAttachments' | 'removeAttachment' | 'removeForwardedAttachment'
  >;
}) {
  // An assigned ID only proves that the attachment record exists. Every save
  // must also wait for content uploads started by earlier concurrent saves.
  const inFlight = new Set<Promise<void>>();
  const [uploading, setUploading] = createSignal(false);

  return {
    uploading,
    async upload(draftId: string, inbox = { inboxId: options.inboxId() }) {
      const attachments = options.attachments
        .list()
        .filter(
          (
            attachment
          ): attachment is Extract<DraftFormAttachment, { type: 'local' }> =>
            attachment.type === 'local' && !attachment.attachmentId
        );
      let run: Promise<void> | undefined;
      if (attachments.length) {
        run = options.services.uploadAttachments({
          draftId: draftId,
          attachments: attachments.map((attachment) => attachment.file),
          inboxId: inbox.inboxId,
          onAttachmentAdded: options.attachments.assignAttachmentId,
          onAttachmentUploadFailed: options.attachments.clearAttachmentId,
        });
        const settled = run.then(
          () => undefined,
          () => undefined
        );
        inFlight.add(settled);
        setUploading(true);
        void settled.then(() => {
          inFlight.delete(settled);
          setUploading(inFlight.size > 0);
        });
      }
      while (inFlight.size) await Promise.all([...inFlight]);
      // All work has settled; rethrow this save's own upload failure.
      if (run) await run;
    },
    remove(attachment: DraftFormAttachment) {
      const state = options.attachments;
      if (attachment.type === 'local') state.removeByFile(attachment.file);
      else if (attachment.type === 'forwarded')
        state.removeForwarded(attachment.attachmentId);
      else state.removeById(attachment.attachmentId);

      const draftId = options.draftId();
      if (!draftId || !attachment.attachmentId) return;
      const operation =
        attachment.type === 'forwarded'
          ? options.services.removeForwardedAttachment
          : options.services.removeAttachment;
      void operation({
        draftId,
        attachmentId: attachment.attachmentId,
        inboxId: options.inboxId(),
      }).catch(() => {
        // The attachment query reports removal failures; keep optimistic removal.
      });
    },
  };
}
