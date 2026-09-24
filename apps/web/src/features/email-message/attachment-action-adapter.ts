import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import {
  getEmailAttachmentDocument,
  getEmailAttachmentMetadata,
} from '@queries/email/integration';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { EmailAttachment } from './core/email-message';
import { resolveEmailAttachmentBlockName } from './resolve-attachment-block';

export function createEmailAttachmentOpener() {
  const { openWithSplit } = useSplitLayout();
  const openAttachment = async (attachment: EmailAttachment) => {
    const dbId = attachment.db_id;
    if (!dbId) return;
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

    refetchSoupEntity(document_id, 'document');

    const blockName = resolveEmailAttachmentBlockName({
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      documentFileType: maybeDocumentMetadata.value.documentMetadata.fileType,
    });
    openWithSplit(
      { type: blockName, id: document_id },
      { preferNewSplit: true }
    );
  };

  return openAttachment;
}
