import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { downloadFile } from '@filesystem/download';
import { Telemetry } from '@macro-inc/observability';
import { getEmailAttachmentDownloadUrl } from '@queries/email/attachment';
import {
  getEmailAttachmentDocument,
  getEmailAttachmentMetadata,
} from '@queries/email/integration';
import { refetchSoupEntity } from '@queries/soup/cache';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { ResultAsync } from 'neverthrow';
import { type EmailAttachment, isCalendarFile } from './core/email-message';

function attachmentBlockName(attachment: EmailAttachment) {
  const fileType = Object.values(FileTypeMap).findLast(
    (type) => type.mime === attachment.mime_type
  )?.extension;
  return fileType ? fileTypeToBlockName(fileType as FileType) : 'unknown';
}

async function fetchAttachmentBlob(id: string) {
  const response = await fetch(await getEmailAttachmentDownloadUrl(id));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

/**
 * Save an attachment through its authorized download URL. No Drive document
 * is created, so nothing lands in the viewer's files unless they ask for it.
 */
export async function downloadEmailAttachment(attachment: EmailAttachment) {
  return Telemetry.span('email.download_attachment', async (span) => {
    span.setAttr('email.attachment_id', attachment.db_id);
    const blob = await ResultAsync.fromPromise(
      fetchAttachmentBlob(attachment.db_id),
      (error) => error
    );
    if (blob.isErr()) {
      span.error('Attachment download failed');
      toast.failure('Failed to download attachment. Please try again.');
      return;
    }
    await downloadFile(
      new Blob([blob.value], {
        type: attachment.mime_type ?? blob.value.type,
      }),
      attachment.filename ?? 'attachment'
    );
  });
}

export function createEmailAttachmentOpener() {
  const { openWithSplit } = useSplitLayout();
  const openAttachment = async (attachment: EmailAttachment) => {
    if (attachment.reference_url) {
      window.open(attachment.reference_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const dbId = attachment.db_id;
    if (!dbId) return;
    // Macro has no viewer for a calendar file (a message that shows its
    // event opens that instead), so a Drive copy would only say "No preview
    // available"; save the file instead of filing it into Drive.
    if (isCalendarFile(attachment.filename, attachment.mime_type)) {
      await downloadEmailAttachment(attachment);
      return;
    }
    const response = await getEmailAttachmentDocument(dbId);
    if (response.isErr()) {
      toast.failure('Failed to get attachment. Please try again.');
      return Telemetry.error(
        new Error(
          'Failed to get or create attachment document id: ' + response.error
        )
      );
    }
    const { document_id } = response.value;

    const maybeDocumentMetadata = await getEmailAttachmentMetadata(document_id);
    if (maybeDocumentMetadata.isErr()) {
      toast.failure('Failed to get attachment. Please try again.');
      return Telemetry.error(
        new Error(
          'Failed to get or create attachment document metadata: ' +
            maybeDocumentMetadata.error
        )
      );
    }

    refetchSoupEntity(document_id, 'document').catch((error) =>
      Telemetry.error(error, { surface: 'email-attachment' })
    );

    openWithSplit(
      { type: attachmentBlockName(attachment), id: document_id },
      { preferNewSplit: true }
    );
  };

  return openAttachment;
}
