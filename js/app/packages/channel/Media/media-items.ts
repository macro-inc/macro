import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import type { ApiChannelAttachment } from '@service-comms/client';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';

export type MediaKind = 'image' | 'video';

export type MediaItem = {
  attachmentId: string;
  entityId: string;
  kind: MediaKind;
  width?: number | null;
  height?: number | null;
  createdAt?: string;
  senderId?: string;
  messageId?: string;
};

type AttachmentWithMediaFields = {
  id: string;
  entity_id: string;
  entity_type: string;
  width?: number | null;
  height?: number | null;
  created_at?: string;
  sender_id?: string;
  message_id?: string;
};

export function getMediaKind(entityType: string): MediaKind | undefined {
  if (entityType === STATIC_IMAGE) return 'image';
  if (entityType === STATIC_VIDEO) return 'video';
  return undefined;
}

export function isMediaAttachmentType(entityType: string): boolean {
  return entityType === STATIC_IMAGE || entityType === STATIC_VIDEO;
}

export function partitionAttachments<T extends { entity_type: string }>(
  attachments: T[]
) {
  const mediaAttachments: T[] = [];
  const documentAttachments: T[] = [];

  for (const attachment of attachments) {
    if (isMediaAttachmentType(attachment.entity_type)) {
      mediaAttachments.push(attachment);
      continue;
    }

    if (!isStaticAttachmentType(attachment.entity_type)) {
      documentAttachments.push(attachment);
    }
  }

  return { mediaAttachments, documentAttachments };
}

function mapAttachmentToMediaItem(
  attachment: AttachmentWithMediaFields
): MediaItem | undefined {
  const kind = getMediaKind(attachment.entity_type);
  if (!kind) return;

  return {
    attachmentId: attachment.id,
    entityId: attachment.entity_id,
    kind,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
    createdAt: attachment.created_at,
    senderId: attachment.sender_id,
    messageId: attachment.message_id,
  };
}

export function mapAttachmentsToMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[]
): MediaItem[] {
  return attachments.flatMap((attachment) => {
    const item = mapAttachmentToMediaItem(attachment);
    return item ? [item] : [];
  });
}

export function mapMessageAttachmentsToMediaItems(
  attachments: ApiMessageAttachment[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments);
}

export function mapChannelAttachmentsToMediaItems(
  attachments: ApiChannelAttachment[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments);
}
