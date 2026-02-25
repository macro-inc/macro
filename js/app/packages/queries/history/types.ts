import type { DateValue } from '@core/util/date';
import type { Item } from '@service-storage/generated/schemas/item';

type BaseHistoryItem = Pick<Item, 'id' | 'name'> & {
  createdAt?: DateValue | null;
  updatedAt?: DateValue | null;
  deletedAt?: DateValue | null;
  // NOTE: the history endpoint does not return this field so this
  // is a placeholder for now
  viewedAt?: DateValue;
  // TODO: item name without safe name transform
  rawName?: string;
  // Normalized owner field: BasicDocument.owner, Chat.userId, Project.userId
  ownerId: string;
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
  data: Item[];
};
