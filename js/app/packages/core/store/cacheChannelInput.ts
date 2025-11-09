import type { BlockName } from '@core/block';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';

// Define constants
export const STATIC_IMAGE = 'static/image' as const;
export const STATIC_VIDEO = 'static/video' as const;

export type StaticImageType = typeof STATIC_IMAGE;
export type StaticVideoType = typeof STATIC_VIDEO;
export type StaticAttachmentType = StaticImageType | StaticVideoType;

export function isStaticAttachmentType(
  value: any
): value is StaticAttachmentType {
  return value === STATIC_IMAGE || value === STATIC_VIDEO;
}

export type AttachmentType = BlockName | StaticAttachmentType;

export type InputAttachment = {
  id: string;
  name: string;
  blockName: AttachmentType;
  pending?: boolean;
};

export interface DraftMessage {
  content: string;
  attachments: InputAttachment[];
  lastModified: number;
  threadId?: string;
}

export const [cachedChannelInputStore, setCachedChannelInputStore] =
  makePersisted(
    createStore<
      Partial<{
        [key: string]: DraftMessage | undefined;
      }>
    >({}),
    {
      name: 'cachedChannelInputStore',
    }
  );
