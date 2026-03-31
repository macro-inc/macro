import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import type { ApiChannelAttachment } from '@service-comms/client';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';

export type MediaKind = 'image' | 'video';

export type MediaItem = {
  fileId: string;
  kind: MediaKind;
  width?: number | null;
  height?: number | null;
};

type AttachmentWithMediaFields = {
  id: string;
  entity_id: string;
  entity_type: string;
  width?: number | null;
  height?: number | null;
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
    fileId: attachment.entity_id,
    kind,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
  };
}

export function mapAttachmentsToMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[],
  previousItems: MediaItem[] = []
): MediaItem[] {
  const previousByAttachmentId = new Map(
    attachments.map((attachment, index) => [attachment.id, previousItems[index]])
  );

  return attachments.flatMap((attachment) => {
    const item = mapAttachmentToMediaItem(attachment);
    if (!item) return [];

    const previousItem = previousByAttachmentId.get(attachment.id);
    if (
      previousItem &&
      previousItem.fileId === item.fileId &&
      previousItem.kind === item.kind &&
      previousItem.width === item.width &&
      previousItem.height === item.height
    ) {
      return [previousItem];
    }

    return [item];
  });
}

export function mapMessageAttachmentsToMediaItems(
  attachments: ApiMessageAttachment[],
  previousItems?: MediaItem[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments, previousItems);
}

export function mapChannelAttachmentsToMediaItems(
  attachments: ApiChannelAttachment[],
  previousItems?: MediaItem[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments, previousItems);
}
