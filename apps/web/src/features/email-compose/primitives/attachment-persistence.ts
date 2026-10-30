import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type {
  EmailAttachmentStorage,
  EmailComposeFeedback,
  EmailConnectivity,
} from '../context/compose-capabilities';
import { settle } from './background-work';
import type { DraftFormAttachment } from './email-form-state';
import type { EmailFormContextValue } from './email-form-types';

type AttachmentState = Pick<
  EmailFormContextValue['attachments'],
  | 'list'
  | 'markUploadComplete'
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
/** One save's upload: what it writes to and whether it still may. */
type UploadTarget = {
  draftId: string;
  inboxId: string | undefined;
  draftGeneration: number;
  uploadGeneration: number;
  stillCurrent: () => boolean;
};

export function createAttachmentPersistence(options: {
  attachments: AttachmentState;
  /** Durable working copies must not hide attachments still present on the server. */
  confirmRemoval?: boolean;
  allowed?: Accessor<boolean>;
  draftId: Accessor<string | null | undefined>;
  inboxId: Accessor<string | undefined>;
  draftGeneration?: Accessor<number>;
  services: Pick<
    EmailAttachmentStorage,
    | 'completeAttachment'
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

  /** An upload an earlier save started but did not finish; it must upload again. */
  const isUnfinishedUpload = (
    attachment: DraftFormAttachment,
    uploadGeneration: number
  ): attachment is Extract<DraftFormAttachment, { type: 'local' }> & {
    attachmentId: string;
  } =>
    attachment.type === 'local' &&
    pendingFiles.get(attachment.file) !== uploadGeneration &&
    !!attachment.uploadPending &&
    !!attachment.attachmentId;

  /** Uploads local files that have no attachment record yet; returns this save's upload. */
  const startUploads = (target: UploadTarget) => {
    const attachments = options.attachments
      .list()
      .filter(
        (
          attachment
        ): attachment is Extract<DraftFormAttachment, { type: 'local' }> =>
          attachment.type === 'local' &&
          !attachment.attachmentId &&
          pendingFiles.get(attachment.file) !== target.uploadGeneration
      );
    if (!attachments.length) return undefined;
    for (const attachment of attachments)
      pendingFiles.set(attachment.file, target.uploadGeneration);
    const upload = options.services.uploadAttachments({
      draftId: target.draftId,
      attachments: attachments.map((attachment) => attachment.file),
      inboxId: target.inboxId,
      draftGeneration: target.draftGeneration,
      onAttachmentAdded: (file, id) => {
        if (target.stillCurrent())
          options.attachments.assignAttachmentId(file, id);
      },
      onAttachmentUploaded: (file, id) => {
        if (target.stillCurrent())
          options.attachments.markAttachmentUploaded(file, id);
      },
      onAttachmentUploadFailed: (file) => {
        if (target.stillCurrent()) options.attachments.clearAttachmentId(file);
      },
    });

    // Only the save that started an upload rethrows its failure.
    const settled = settle(upload);
    inFlight.add(settled);
    setUploading(true);
    const releaseUpload = async () => {
      await settled;
      for (const attachment of attachments)
        if (pendingFiles.get(attachment.file) === target.uploadGeneration)
          pendingFiles.delete(attachment.file);
      inFlight.delete(settled);
      setUploading(inFlight.size > 0);
    };
    fireAndForget(releaseUpload(), 'email-compose');
    return upload;
  };

  const completeUploads = async (target: UploadTarget) => {
    for (const attachment of options.attachments.list()) {
      if (attachment.type === 'remote' && attachment.uploadPending) {
        await options.services.completeAttachment({
          draftId: target.draftId,
          attachmentId: attachment.attachmentId,
          inboxId: target.inboxId,
          draftGeneration: target.draftGeneration,
        });
        if (target.stillCurrent())
          options.attachments.markUploadComplete(attachment.attachmentId);
      }
    }
    const forwarded = options.attachments
      .list()
      .filter((attachment) => attachment.type === 'forwarded');
    if (forwarded.length) {
      await options.services.addForwardedAttachments({
        draftId: target.draftId,
        inboxId: target.inboxId,
        draftGeneration: target.draftGeneration,
        attachments: forwarded.map(({ attachmentId }) => ({ attachmentId })),
      });
    }
  };

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
      const draftGeneration = options.draftGeneration?.() ?? 0;
      const target: UploadTarget = {
        draftId,
        inboxId: inbox.inboxId,
        draftGeneration,
        uploadGeneration,
        stillCurrent: () =>
          !disposed &&
          options.allowed?.() !== false &&
          uploadGeneration === generation &&
          draftGeneration === (options.draftGeneration?.() ?? 0) &&
          options.draftId() === draftId &&
          options.inboxId() === inbox.inboxId,
      };
      for (const attachment of options.attachments.list()) {
        if (!isUnfinishedUpload(attachment, uploadGeneration)) continue;
        if (options.confirmRemoval) {
          // Durable transport checks the latest receipt under a cross-tab upload lock.
          options.attachments.clearAttachmentId(attachment.file);
          continue;
        }
        await options.services.removeAttachment({
          draftId,
          attachmentId: attachment.attachmentId,
          inboxId: inbox.inboxId,
          draftGeneration,
        });
        if (!target.stillCurrent()) return;
        options.attachments.clearAttachmentId(attachment.file);
      }
      const ownUpload = startUploads(target);
      while (inFlight.size) await Promise.all([...inFlight]);
      // All work has settled; rethrow this save's own upload failure.
      if (ownUpload) await ownUpload;
      if (!target.stillCurrent()) return;
      await completeUploads(target);
    },
    async remove(attachment: DraftFormAttachment) {
      const state = options.attachments;
      // Document attachments exist only in the AI draft composer, which owns
      // their removal; no draft row holds them.
      if (attachment.type === 'document') return false;
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
              draftGeneration: options.draftGeneration?.() ?? 0,
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
        // Preserve the existing REST composer's optimistic removal behavior.
        fireAndForget(settle(operation(request)), 'email-compose');
      }
      return true;
    },
  };
}
