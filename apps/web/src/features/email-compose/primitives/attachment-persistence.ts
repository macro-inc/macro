import { type Accessor, createSignal } from 'solid-js';
import type {
  EmailAttachmentStorage,
  EmailComposeFeedback,
  EmailConnectivity,
} from '../context/compose-capabilities';
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

/**
 * A queued save carries only text; file bytes live in the composer's memory
 * until a save commits, so adding attachments offline is refused rather than
 * silently missed. Resolves true when the add must not proceed.
 */
export async function refuseAttachmentsOffline(
  connectivity: EmailConnectivity,
  notices: Pick<EmailComposeFeedback, 'blockingNotice'>
): Promise<boolean> {
  if (!connectivity.looksOffline()) return false;
  await notices.blockingNotice({
    title: "You're offline",
    body: "Attachments can't be added while you're offline. Reconnect and try again.",
  });
  return true;
}

/** Attachment transport and completion, independent of draft/send orchestration. */
export function createAttachmentPersistence(options: {
  attachments: AttachmentState;
  draftId: Accessor<string | null | undefined>;
  inboxId: Accessor<string | undefined>;
  services: Pick<
    EmailAttachmentStorage,
    | 'uploadAttachments'
    | 'addForwardedAttachments'
    | 'removeAttachment'
    | 'removeForwardedAttachment'
  >;
}) {
  // An assigned ID only proves that the attachment record exists. Every save
  // must also wait for content uploads started by earlier concurrent saves.
  const inFlight = new Set<Promise<void>>();
  const [uploading, setUploading] = createSignal(false);
  let generation = 0;

  return {
    uploading,
    /** Local files can be uploaded again; remote-only draft files cannot be cloned. */
    detach() {
      generation += 1;
      let removed = 0;
      for (const attachment of options.attachments.list()) {
        if (attachment.type === 'local') {
          options.attachments.clearAttachmentId(attachment.file);
        } else if (attachment.type === 'remote') {
          options.attachments.removeById(attachment.attachmentId);
          removed += 1;
        }
      }
      return removed;
    },
    async upload(draftId: string, inbox = { inboxId: options.inboxId() }) {
      const uploadGeneration = generation;
      const stillCurrent = () =>
        uploadGeneration === generation && options.draftId() === draftId;
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
          onAttachmentAdded: (file, id) => {
            if (stillCurrent())
              options.attachments.assignAttachmentId(file, id);
          },
          onAttachmentUploadFailed: (file) => {
            if (stillCurrent()) options.attachments.clearAttachmentId(file);
          },
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
      if (!stillCurrent()) return;
      const forwarded = options.attachments
        .list()
        .filter((attachment) => attachment.type === 'forwarded');
      if (forwarded.length) {
        await options.services.addForwardedAttachments({
          draftId,
          inboxId: inbox.inboxId,
          attachments: forwarded.map(({ attachmentId }) => ({ attachmentId })),
        });
      }
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
