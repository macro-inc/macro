import { getUploadFileSize } from '@core/mobile/nativeStagedUpload';
import type { DraftFormAttachment } from './email-form-state';

/**
 * Splits picked files, in picking order, into those that still fit under the
 * inbox's delivery limit beside the current attachments and those that do not.
 * A file that does not fit is skipped, so a smaller later file can still attach.
 */
export function partitionByAttachmentLimit(
  files: readonly File[],
  current: readonly DraftFormAttachment[],
  limitBytes: number
): { attachable: File[]; oversized: File[] } {
  let total = current.reduce(
    (sum, attachment) =>
      sum +
      (attachment.type === 'local'
        ? getUploadFileSize(attachment.file)
        : attachment.fileSize),
    0
  );
  const attachable: File[] = [];
  const oversized: File[] = [];
  for (const file of files) {
    const size = getUploadFileSize(file);
    if (total + size > limitBytes) {
      oversized.push(file);
      continue;
    }
    total += size;
    attachable.push(file);
  }
  return { attachable, oversized };
}
