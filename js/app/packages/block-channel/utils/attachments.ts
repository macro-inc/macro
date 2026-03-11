import { isStaticAttachmentType } from '@core/store/cacheChannelInput';
import type { Attachment } from '@queries/channel/types';
import { isItemType } from '@service-storage/client';

/**
 * Filter out unsafe attachments that might have been sent with block names
 * instead of itemTypes as the entity type.
 */
export function isSafeAttachment(attachment: Attachment) {
  if (isStaticAttachmentType(attachment.entity_type)) return true;
  if (isItemType(attachment.entity_type)) return true;
  return false;
}

/**
 * Filter attachments to only safe ones
 */
export function filterSafeAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.filter(isSafeAttachment);
}
