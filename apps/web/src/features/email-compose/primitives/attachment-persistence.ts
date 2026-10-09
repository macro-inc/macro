import { type Accessor, createSignal, onCleanup } from 'solid-js';
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
  | 'markAttachmentUploaded'
  | 'clearAttachmentId'
  | 'removeByFile'
  | 'removeById'
  | 'removeForwarded'
>;

/**
 * Attachment creation requires connectivity; existing files remain in the
 * durable working copy while offline. Resolves true when the add must not proceed.
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
  /** Durable working copies must not hide attachments still present on the server. */
  confirmRemoval?: boolean;
  allowed?: Accessor<boolean>;
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
  const pendingFiles = new Map<File, number>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    generation += 1;
  });
  const [uploading, setUploading] = createSignal(false);
  let generation = 0;
  const [removals, setRemovals] = createSignal(0);

  return {
    uploading: () => uploading() || removals() > 0,
    removing: () => removals() > 0,
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
      if (disposed || options.allowed?.() === false) return;
      const uploadGeneration = generation;
      const stillCurrent = () =>
        !disposed &&
        options.allowed?.() !== false &&
        uploadGeneration === generation &&
        options.draftId() === draftId &&
        options.inboxId() === inbox.inboxId;
      for (const attachment of options.attachments.list()) {
        if (
          attachment.type !== 'local' ||
          pendingFiles.get(attachment.file) === uploadGeneration ||
          !attachment.uploadPending ||
          !attachment.attachmentId
        )
          continue;
        if (options.confirmRemoval) {
          // Durable transport checks the latest receipt under a cross-tab upload lock.
          options.attachments.clearAttachmentId(attachment.file);
          continue;
        }
        await options.services.removeAttachment({
          draftId,
          attachmentId: attachment.attachmentId,
          inboxId: inbox.inboxId,
        });
        if (!stillCurrent()) return;
        options.attachments.clearAttachmentId(attachment.file);
      }
      const attachments = options.attachments
        .list()
        .filter(
          (
            attachment
          ): attachment is Extract<DraftFormAttachment, { type: 'local' }> =>
            attachment.type === 'local' &&
            !attachment.attachmentId &&
            pendingFiles.get(attachment.file) !== uploadGeneration
        );
      let run: Promise<void> | undefined;
      if (attachments.length) {
        for (const attachment of attachments)
          pendingFiles.set(attachment.file, uploadGeneration);
        run = options.services.uploadAttachments({
          draftId: draftId,
          attachments: attachments.map((attachment) => attachment.file),
          inboxId: inbox.inboxId,
          onAttachmentAdded: (file, id) => {
            if (stillCurrent())
              options.attachments.assignAttachmentId(file, id);
          },
          onAttachmentUploaded: (file, id) => {
            if (stillCurrent())
              options.attachments.markAttachmentUploaded(file, id);
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
          for (const attachment of attachments)
            if (pendingFiles.get(attachment.file) === uploadGeneration)
              pendingFiles.delete(attachment.file);
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
    async remove(attachment: DraftFormAttachment) {
      const state = options.attachments;
      const draftId = options.draftId();
      const removalGeneration = generation;
      const operation =
        attachment.type === 'forwarded'
          ? options.services.removeForwardedAttachment
          : options.services.removeAttachment;
      const request =
        draftId && attachment.attachmentId
          ? {
              draftId,
              attachmentId: attachment.attachmentId,
              inboxId: options.inboxId(),
            }
          : undefined;
      if (options.confirmRemoval && request) {
        setRemovals((count) => count + 1);
        try {
          await operation(request);
        } finally {
          setRemovals((count) => count - 1);
        }
        if (generation !== removalGeneration || options.draftId() !== draftId)
          return false;
      }
      if (attachment.type === 'local') state.removeByFile(attachment.file);
      else if (attachment.type === 'forwarded')
        state.removeForwarded(attachment.attachmentId);
      else state.removeById(attachment.attachmentId);
      if (!options.confirmRemoval && request) {
        void operation(request).catch(() => {
          // Preserve the existing REST composer's optimistic removal behavior.
        });
      }
      return true;
    },
  };
}
