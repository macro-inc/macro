import {
  staticFileIdEndpoint,
  staticFileSizedEndpoint,
} from '@core/constant/servers';
import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';

export type MediaItem = {
  id: string;
  /** Sized variant for previews (1080/ for images, original for videos) */
  src: string;
  /** Full-resolution original — used when expanding */
  fullSrc: string;
  kind: 'image' | 'video';
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

function getMediaKind(entityType: string): MediaItem['kind'] | undefined {
  if (entityType === STATIC_IMAGE) return 'image';
  if (entityType === STATIC_VIDEO) return 'video';
  return undefined;
}

function isMediaAttachmentType(entityType: string): boolean {
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

  const fullSrc = staticFileIdEndpoint(attachment.entity_id);
  return {
    id: attachment.entity_id,
    src:
      kind === 'image'
        ? staticFileSizedEndpoint(attachment.entity_id, 'medium')
        : fullSrc,
    fullSrc,
    kind,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
  };
}

function mapAttachmentsToMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[],
  previousItems: MediaItem[] = []
): MediaItem[] {
  const previousByAttachmentId = new Map(
    attachments.map((attachment, index) => [
      attachment.id,
      previousItems[index],
    ])
  );

  return attachments.flatMap((attachment) => {
    const item = mapAttachmentToMediaItem(attachment);
    if (!item) return [];

    const previousItem = previousByAttachmentId.get(attachment.id);
    if (
      previousItem &&
      previousItem.src === item.src &&
      previousItem.fullSrc === item.fullSrc &&
      previousItem.kind === item.kind &&
      previousItem.width === item.width &&
      previousItem.height === item.height
    ) {
      return [previousItem];
    }

    return [item];
  });
}

export function mapMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[],
  previousItems?: MediaItem[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments, previousItems);
}
