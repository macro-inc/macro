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
  /** Local preview for optimistic media we just uploaded/sent. */
  previewSrc?: string;
  kind: 'image' | 'video';
  width?: number | null;
  height?: number | null;
};

type AttachmentWithMediaFields = {
  id: string;
  entity_id: string;
  entity_type: string;
  previewSrc?: string;
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
    previewSrc: attachment.previewSrc,
    kind,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
  };
}

function mapAttachmentsToMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[],
  previousItems: MediaItem[] = []
): MediaItem[] {
  const previousByMediaId = new Map(
    previousItems.map((item) => [item.id, item])
  );

  return attachments.flatMap((attachment, index) => {
    const item = mapAttachmentToMediaItem(attachment);
    if (!item) return [];

    const previousItem =
      previousItems[index]?.id === item.id
        ? previousItems[index]
        : previousByMediaId.get(item.id);
    const nextItem =
      previousItem && previousItem.id === item.id
        ? {
            ...item,
            previewSrc: item.previewSrc ?? previousItem.previewSrc,
            width: item.width ?? previousItem.width,
            height: item.height ?? previousItem.height,
          }
        : item;

    if (
      previousItem &&
      previousItem.src === nextItem.src &&
      previousItem.fullSrc === nextItem.fullSrc &&
      previousItem.previewSrc === nextItem.previewSrc &&
      previousItem.kind === nextItem.kind &&
      previousItem.width === nextItem.width &&
      previousItem.height === nextItem.height
    ) {
      return [previousItem];
    }

    return [nextItem];
  });
}

export function mapMediaItems<T extends AttachmentWithMediaFields>(
  attachments: T[],
  previousItems?: MediaItem[]
): MediaItem[] {
  return mapAttachmentsToMediaItems(attachments, previousItems);
}
