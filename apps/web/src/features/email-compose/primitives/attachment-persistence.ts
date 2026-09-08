import { type Accessor, createSignal } from 'solid-js';
import type { EmailAttachmentStorage } from '../context/compose-services';
import type { DraftFormAttachment } from './email-form-state';
import type { EmailFormContextValue } from './email-form-types';

type AttachmentState = Pick<
  EmailFormContextValue['attachments'],
  | 'list'
  | 'assignAttachmentID'
  | 'clearAttachmentID'
  | 'removeByFile'
  | 'removeByID'
  | 'removeForwarded'
>;

/** Attachment transport and completion, independent of draft/send orchestration. */
export function createAttachmentPersistence(options: {
  attachments: Accessor<AttachmentState>;
  draftId: Accessor<string | null | undefined>;
  linkId: Accessor<string | undefined>;
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
    async upload(draftId: string, inbox = { linkId: options.linkId() }) {
      const attachments = options
        .attachments()
        .list()
        .filter(
          (
            attachment
          ): attachment is Extract<DraftFormAttachment, { type: 'local' }> =>
            attachment.type === 'local' && !attachment.attachmentID
        );
      let run: Promise<void> | undefined;
      if (attachments.length) {
        run = options.services.uploadAttachments({
          draftID: draftId,
          attachments: attachments.map((attachment) => attachment.file),
          linkId: inbox.linkId,
          onAttachmentAdded: (file, id) =>
            options.attachments().assignAttachmentID(file, id),
          onAttachmentUploadFailed: (file) =>
            options.attachments().clearAttachmentID(file),
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
      const state = options.attachments();
      if (attachment.type === 'local') state.removeByFile(attachment.file);
      else if (attachment.type === 'forwarded')
        state.removeForwarded(attachment.attachmentID);
      else state.removeByID(attachment.attachmentID);

      const draftID = options.draftId();
      if (!draftID || !attachment.attachmentID) return;
      const operation =
        attachment.type === 'forwarded'
          ? options.services.removeForwardedAttachment
          : options.services.removeAttachment;
      void operation({
        draftID,
        attachmentID: attachment.attachmentID,
        linkId: options.linkId(),
      }).catch(() => {
        // The attachment query reports removal failures; keep optimistic removal.
      });
    },
  };
}
