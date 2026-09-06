import type { Accessor } from 'solid-js';
import type { EmailComposeServices } from '../context/compose-services';
import { createComposeOperation } from './compose-operation';
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
    EmailComposeServices,
    'uploadAttachments' | 'removeAttachment' | 'removeForwardedAttachment'
  >;
}) {
  const upload = createComposeOperation(options.services.uploadAttachments);
  const remove = createComposeOperation(options.services.removeAttachment);
  const removeForwarded = createComposeOperation(
    options.services.removeForwardedAttachment
  );
  // An assigned ID only proves that the attachment record exists. Every save
  // must also wait for content uploads started by earlier concurrent saves.
  const inFlight = new Set<Promise<void>>();

  return {
    uploading: upload.pending,
    async upload(draftId: string) {
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
        run = upload.run({
          draftID: draftId,
          attachments: attachments.map((attachment) => attachment.file),
          linkId: options.linkId(),
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
        settled.then(() => inFlight.delete(settled));
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
        attachment.type === 'forwarded' ? removeForwarded : remove;
      operation.start({
        draftID,
        attachmentID: attachment.attachmentID,
        linkId: options.linkId(),
      });
    },
  };
}
