import type { SubType } from '@macro-entity';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
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

export type PreviewItemAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: FileType;
  subType?: SubType;
  channelType?: never;
} & BasePreviewItem<Exclude<ItemType, 'project'>>;

export type PreviewProjectAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  subType?: never;
  channelType?: never;
} & BasePreviewItem<'project'>;

export type PreviewDocumentAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType: FileType;
  subType?: SubType;
  channelType?: never;
} & BasePreviewItem<'document'>;

export type PreviewChannelAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  subType?: never;
  channelType?: ChannelType;
} & BasePreviewItem<Exclude<ItemType, 'project'>>;

export type PreviewItem =
  | PreviewItemLoading
  | PreviewItemNoAccess
  | PreviewItemAccess
  | PreviewProjectAccess
  | PreviewDocumentAccess
  | PreviewChannelAccess;

export interface ItemEntity {
  id: string;
  type?: ItemType;
}

export const isAccessiblePreviewItem = (item: PreviewItem) => {
  return !item.loading && item.access === 'access';
};
