import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { startFileDownload } from '@core/util/createFileDownload';
import { Telemetry } from '@macro-inc/observability';
import { emailAttachmentDownloadSource } from '@queries/email/attachment-download';
import {
  getEmailAttachmentDocument,
  getEmailAttachmentMetadata,
} from '@queries/email/integration';
import { refetchSoupEntity } from '@queries/soup/cache';
import { FileTypeMap } from '@service-storage/fileTypeMap';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { type EmailAttachment, isCalendarFile } from './core/email-message';

function attachmentBlockName(attachment: EmailAttachment) {
  const fileType = Object.values(FileTypeMap).findLast(
    (type) => type.mime === attachment.mime_type
  )?.extension;
  return fileType ? fileTypeToBlockName(fileType as FileType) : 'unknown';
}

/**
 * Save an attachment through its authorized download URL. No Drive document
 * is created, so nothing lands in the viewer's files unless they ask for it.
 */
export async function downloadEmailAttachment(attachment: EmailAttachment) {
  await startFileDownload(emailAttachmentDownloadSource(attachment));
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
      toast.failure('Attachment unavailable', {
        subtext: 'Please try again',
      });
      return Telemetry.error(
        new Error(
          'Failed to get or create attachment document id: ' + response.error
        )
      );
    }
    const { document_id } = response.value;

    const maybeDocumentMetadata = await getEmailAttachmentMetadata(document_id);
    if (maybeDocumentMetadata.isErr()) {
      toast.failure('Attachment unavailable', {
        subtext: 'Please try again',
      });
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
