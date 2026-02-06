import type { ChannelWithParticipants, IUser } from '@core/user';
import type { EmailEntity } from '@macro-entity';
import type { HistoryItem } from '@queries/history/history';
import type { Item } from '@service-storage/generated/schemas/item';

/**
 * Categories for quick find items.
 * These map to the buckets used in MentionsMenu.
 */
export type QuickFindCategory =
  | 'user'
  | 'channel'
  | 'dm'
  | 'document'
  | 'note'
  | 'task'
  | 'chat'
  | 'folder'
  | 'email';

export type QuickFindItem<T extends QuickFindCategory = QuickFindCategory> = {
  id: string;
  category: T;
  searchText: string;
  /** Unix timestamp for recency sorting (viewedAt or updatedAt) */
  timestamp: number;
  /** Secondary timestamp for sorting (updatedAt when viewedAt is primary) */
  updatedAt?: number;
  /** for user items: last dm interaction timestamp */
  lastInteraction?: number;
} & QuickFindData<T>;

type QuickFindDataMap = {
  user: IUser;
  channel: ChannelWithParticipants;
  dm: ChannelWithParticipants;
  email: EmailEntity;
  document: HistoryItem;
  note: HistoryItem;
  task: HistoryItem;
  chat: HistoryItem;
  folder: HistoryItem;
};

type QuickFindData<T extends QuickFindCategory> = {
  data: QuickFindDataMap[T];
};

export function isUserItem(item: QuickFindItem): item is QuickFindItem<'user'> {
  return item.category === 'user';
}

export function isChannelItem(
  item: QuickFindItem
): item is QuickFindItem<'channel' | 'dm'> {
  return item.category === 'channel' || item.category === 'dm';
}

export function isEmailItem(
  item: QuickFindItem
): item is QuickFindItem<'email'> {
  return item.category === 'email';
}

export function isHistoryItem(
  item: QuickFindItem
): item is QuickFindItem<'document' | 'note' | 'task' | 'chat' | 'folder'> {
  return ['document', 'note', 'task', 'chat', 'folder'].includes(item.category);
}

export type QuickFindCollections = {
  all: QuickFindItem[];
  byCategory: Map<QuickFindCategory, QuickFindItem[]>;
  users: QuickFindItem<'user'>[];
  channels: QuickFindItem<'channel' | 'dm'>[];
  items: QuickFindItem<'document' | 'note' | 'task' | 'chat' | 'folder'>[];
  emails: QuickFindItem<'email'>[];
};

type MentionEntityDataMap = {
  item: Item;
  user: IUser;
  channel: ChannelWithParticipants;
  email: EmailEntity;
};

export type MentionEntity<K extends keyof MentionEntityDataMap> = {
  kind: K;
  id: string;
  data: MentionEntityDataMap[K];
};

export type MentionEntities = {
  users: MentionEntity<'user'>[];
  items: MentionEntity<'item'>[];
  channels: MentionEntity<'channel'>[];
  emails: MentionEntity<'email'>[];
};

export type QuickFindContextValue = {
  collections: () => QuickFindCollections;
  mentionEntities: () => MentionEntities;
  isLoading: () => boolean;
};
