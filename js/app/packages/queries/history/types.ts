import type { Item } from '@service-storage/generated/schemas/item';

type BaseHistoryItem = Pick<
  Item,
  'id' | 'name' | 'createdAt' | 'updatedAt' | 'deletedAt'
> & {
  // NOTE: the history endpoint does not return this field so this
  // is a placeholder for now
  viewedAt?: number;
  // TODO: item name without safe name transform
  rawName?: string;
};

export type DocumentHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'document' }>, 'type' | 'fileType' | 'subType'>;

export type ChatHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'chat' }>, 'type' | 'isPersistent'>;

export type ProjectHistoryItem = BaseHistoryItem &
  Pick<Extract<Item, { type: 'project' }>, 'type'>;

/** Minimal history item types containing only the properties actually used */
export type HistoryItem =
  | DocumentHistoryItem
  | ChatHistoryItem
  | ProjectHistoryItem;

export type HistoryQueryResponse = {
  data: HistoryItem[];
};
