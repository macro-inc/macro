import { SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS } from '@core/component/AI/constant';
import { FileType as FileTypeMap } from '@service-cognition/generated/schemas/fileType';
import type { AttachmentMetadata, AttachmentPreview, FileType } from '../types';

// maps file type string to FileType enum if it exists
export const asFileType = (
  fileType: string | null | undefined
): FileType | undefined => {
  return Object.entries(FileTypeMap).find(([key, _]) => key === fileType)?.[1];
};

export const isImageAttachment = (attachment: AttachmentPreview) => {
  if (attachment.attachmentType === 'image') return true;
  if (attachment.attachmentType === 'document') {
    if (!attachment.metadata) return false;
    if (attachment.metadata.type === 'image') return true;
    if (attachment.metadata.type === 'document') {
      return SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS.includes(
        attachment.metadata.document_type
      );
    }
    return false;
  }
  return false;
};

// returns true for dss image and false for sfs image
export const isDssImage = (
  attachment: AttachmentPreview
): attachment is {
  attachmentType: 'document';
  metadata: Extract<AttachmentMetadata, { type: 'document' }>;
} => {
  if (!isImageAttachment(attachment)) return false;
  return attachment.metadata?.type === 'document';
};
