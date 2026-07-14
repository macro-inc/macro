import type { BlockAlias, BlockName } from '@core/block';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

// Define constants
export const STATIC_IMAGE = 'static/image' as const;
export const STATIC_VIDEO = 'static/video' as const;

type StaticImageType = typeof STATIC_IMAGE;
type StaticVideoType = typeof STATIC_VIDEO;
type StaticAttachmentType = StaticImageType | StaticVideoType;

export function isStaticAttachmentType(
  value: any
): value is StaticAttachmentType {
  return value === STATIC_IMAGE || value === STATIC_VIDEO;
}

type AttachmentType = BlockName | BlockAlias | StaticAttachmentType;

type InputAttachment = {
  id: string;
  name: string;
  blockName: AttachmentType;
  pending?: boolean;
  file?: File;
};

interface DraftMessage {
  content: string;
  attachments: InputAttachment[];
  lastModified: number;
  threadId?: string;
}

const [_cachedChannelInputStore, _setCachedChannelInputStore] = makePersisted(
  createStore<
    Partial<{
      [key: string]: DraftMessage | undefined;
    }>
  >({}),
  {
    name: 'cachedChannelInputStore',
  }
);
