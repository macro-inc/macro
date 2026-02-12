import type { SubType } from '@entity';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import type { Message } from '@service-comms/generated/models';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';

type AccessType = 'access' | 'no_access' | 'does_not_exist';

type PreviewItemLoading = { loading: true } & BasePreviewItem;

export type PreviewItemNoAccess = {
  access: Extract<AccessType, 'no_access' | 'does_not_exist'>;
  loading: false;
} & BasePreviewItem;

type BasePreviewItem<T extends ItemType = ItemType> = {
  id: string;
  type: T;
  owner?: string;
  updatedAt?: number;
};

/** this is a catch-all type for access items that do not have a more specific type */
type PreviewItemAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: FileType;
  subType?: SubType;
  channelType?: never;
} & BasePreviewItem<Exclude<ItemType, 'project' | 'document' | 'channel'>>;

type PreviewProjectAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  subType?: never;
  channelType?: never;
} & BasePreviewItem<'project'>;

type PreviewDocumentAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: FileType;
  subType?: SubType;
  channelType?: never;
} & BasePreviewItem<'document'>;

export type MessageContext = Message;

export type PreviewChannelAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  subType?: never;
  channelType?: ChannelType;
  messageContext?: MessageContext | undefined;
} & BasePreviewItem<'channel'>;

export type AccessiblePreviewItem =
  | PreviewItemAccess
  | PreviewProjectAccess
  | PreviewDocumentAccess
  | PreviewChannelAccess;

export type PreviewItem =
  | PreviewItemLoading
  | PreviewItemNoAccess
  | AccessiblePreviewItem;

type BaseItemEntity = {
  id: string;
  type?: Exclude<ItemType, 'channel'>;
};

type ChannelItemEntity = {
  id: string;
  type: 'channel';
  messageId?: string;
};

export type ItemEntity = BaseItemEntity | ChannelItemEntity;

export const isAccessiblePreviewItem = (
  item: PreviewItem
): item is AccessiblePreviewItem => {
  return !item.loading && item.access === 'access';
};

export const isChannelPreviewItem = (
  item: PreviewItem
): item is PreviewChannelAccess => {
  return isAccessiblePreviewItem(item) && item.type === 'channel';
};
