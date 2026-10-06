/**
 * The attachments of a drafted `SendEmail`: Macro documents by reference.
 *
 * The email behind the tool has no draft row until it is sent, so there is
 * nothing to upload attachment bytes into. Instead every attachment is a
 * Macro document - the ones the agent named, plus files the user adds, which
 * are uploaded as documents first - and the backend fetches their files when
 * the send runs. The list keeps uploading files beside resolved documents so
 * the composer can show both.
 */

import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import type { EmailAttachment } from '@service-cognition/generated/tools/types';
import { createSignal } from 'solid-js';

export type DocumentAttachment = Extract<
  DraftFormAttachment,
  { type: 'document' }
>;
type UploadingAttachment = Extract<DraftFormAttachment, { type: 'local' }>;

/** What a document looks like once its metadata has been read. */
export type DocumentDescription = {
  fileName: string;
  mimeType?: string;
};

/** The pill's placeholder until the document's metadata resolves. */
export const PENDING_ATTACHMENT_NAME = 'Attachment';

/**
 * The attachment's display name: the document's name with its extension,
 * added when the stored name lacks it, mirroring what the send attaches.
 */
export function documentAttachmentFileName(
  documentName: string,
  fileType?: string | null
): string {
  const name = documentName.trim() || PENDING_ATTACHMENT_NAME;
  if (!fileType) return name;
  const suffix = `.${fileType.toLowerCase()}`;
  return name.toLowerCase().endsWith(suffix) ? name : `${name}${suffix}`;
}

export type DraftAttachmentsOptions = {
  /** The attachments as the tool call carries them. */
  initial: EmailAttachment[] | undefined;
  /** Reads a document's name and type; rejects when it cannot be read. */
  describe: (documentId: string) => Promise<DocumentDescription>;
  /** Uploads a file as a Macro document; resolves undefined on failure. */
  upload: (file: File) => Promise<{ documentId: string } | undefined>;
  /** Called after any change the tool args should pick up. */
  onChange: () => void;
};

export function createDraftAttachments(options: DraftAttachmentsOptions) {
  const [list, setList] = createSignal<DraftFormAttachment[]>(
    (options.initial ?? []).map(
      (attachment): DocumentAttachment => ({
        type: 'document',
        documentId: attachment.documentId,
        fileName: PENDING_ATTACHMENT_NAME,
        fileSize: 0,
      })
    )
  );
  const [uploadingCount, setUploadingCount] = createSignal(0);

  const describe = async (documentId: string) => {
    let description: DocumentDescription;
    try {
      description = await options.describe(documentId);
    } catch {
      // The pill keeps its placeholder; the send reports a document it
      // cannot read.
      return;
    }
    setList((current) =>
      current.map((attachment) =>
        attachment.type === 'document' && attachment.documentId === documentId
          ? { ...attachment, ...description }
          : attachment
      )
    );
  };
  for (const attachment of list()) {
    if (attachment.type === 'document') void describe(attachment.documentId);
  }

  const removeUploading = (file: File) =>
    setList((current) =>
      current.filter(
        (attachment) => attachment.type !== 'local' || attachment.file !== file
      )
    );

  const upload = async (entry: UploadingAttachment) => {
    setUploadingCount((count) => count + 1);
    try {
      const uploaded = await options.upload(entry.file);
      // The user may have removed the file while it uploaded.
      const stillListed = list().some(
        (attachment) =>
          attachment.type === 'local' && attachment.file === entry.file
      );
      if (!uploaded || !stillListed) {
        removeUploading(entry.file);
        return;
      }
      setList((current) =>
        current.map(
          (attachment): DraftFormAttachment =>
            attachment.type === 'local' && attachment.file === entry.file
              ? {
                  type: 'document',
                  documentId: uploaded.documentId,
                  fileName: entry.file.name,
                  mimeType: entry.file.type || undefined,
                  fileSize: entry.file.size,
                }
              : attachment
        )
      );
      options.onChange();
    } finally {
      setUploadingCount((count) => count - 1);
    }
  };

  return {
    list,
    /** Whether a file added by the user is still becoming a document. */
    uploading: () => uploadingCount() > 0,
    /** Only the attachments the send can carry; uploads in flight are not yet documents. */
    toToolArgs: (): EmailAttachment[] =>
      list().flatMap((attachment) =>
        attachment.type === 'document'
          ? [{ documentId: attachment.documentId }]
          : []
      ),
    add: (added: DraftFormAttachment[]) => {
      const uploads = added.filter(
        (attachment): attachment is UploadingAttachment =>
          attachment.type === 'local'
      );
      if (uploads.length === 0) return;
      setList((current) => [...current, ...uploads]);
      for (const entry of uploads) void upload(entry);
    },
    remove: (removed: DraftFormAttachment) => {
      if (removed.type === 'local') {
        removeUploading(removed.file);
        return;
      }
      if (removed.type !== 'document') return;
      setList((current) =>
        current.filter(
          (attachment) =>
            attachment.type !== 'document' ||
            attachment.documentId !== removed.documentId
        )
      );
      options.onChange();
    },
  };
}
