import type { Accessor } from 'solid-js';
import type {
  EntityData,
  ChannelEntity,
  ChatEntity,
  DocumentEntity,
  TaskEntity,
  EmailEntity,
  ProjectEntity,
} from '@macro-entity';
import type { HotkeyCommand } from '@core/hotkey/types';
import type { IUser } from '@core/user/types';

export type QuickAccessEntity<T extends EntityData = EntityData> = Omit<
  T,
  'ownerId'
>;

/**
 * buckets represent logical groupings of items for quick access.
 * consumers can request specific buckets via uselist() or usesearch().
 */
export type Bucket =
  | 'channel'
  | 'dm'
  | 'person'
  | 'document'
  | 'task'
  | 'note'
  | 'chat'
  | 'project'
  | 'email'
  | 'command';

export type EntityBucket = Exclude<Bucket, 'person' | 'command'>;

export const ALL_BUCKETS: Bucket[] = [
  'channel',
  'dm',
  'person',
  'document',
  'task',
  'note',
  'chat',
  'project',
  'email',
  'command',
];

export type BucketCombination = 'all' | 'channels' | 'documents';

export const BUCKET_COMBINATIONS: Record<BucketCombination, Bucket[]> = {
  all: ALL_BUCKETS,
  channels: ['dm', 'channel'],
  documents: ['document', 'note', 'task', 'chat', 'project'],
};

export type ItemTimestamps = {
  viewedAt?: Date;
  updatedAt?: Date;
  createdAt?: Date;
  lastInteraction?: Date;
};

type QuickAccessBase = {
  id: string;
  searchText: string;
  sortTimestamp: number;
  timestamps: ItemTimestamps;
};

export type EntityItem<T extends QuickAccessEntity = QuickAccessEntity> =
  QuickAccessBase & {
    kind: 'entity';
    bucket: EntityBucket;
    data: T;
  };

export type UserItem = QuickAccessBase & {
  kind: 'user';
  bucket: 'person';
  data: IUser;
};

export type CommandItem = QuickAccessBase & {
  kind: 'command';
  bucket: 'command';
  data: HotkeyCommand;
};

export type QuickAccessItem = EntityItem | UserItem | CommandItem;

export function isEntityItem(item: QuickAccessItem): item is EntityItem {
  return item.kind === 'entity';
}

export function isUserItem(item: QuickAccessItem): item is UserItem {
  return item.kind === 'user';
}

export function isCommandItem(item: QuickAccessItem): item is CommandItem {
  return item.kind === 'command';
}

export function isEntityOfType<T extends EntityData['type']>(
  item: QuickAccessItem,
  entityType: T
): item is EntityItem<Extract<EntityData, { type: T }>> {
  return item.kind === 'entity' && item.data.type === entityType;
}

export function isFromBucket<B extends Bucket>(
  item: QuickAccessItem,
  bucket: B
): boolean {
  return item.bucket === bucket;
}

export type BucketEntityMap = {
  channel: ChannelEntity;
  dm: ChannelEntity;
  document: DocumentEntity;
  task: TaskEntity;
  note: DocumentEntity;
  chat: ChatEntity;
  project: ProjectEntity;
  email: EmailEntity;
  person: never; // UserItem, not EntityItem
  command: never; // CommandItem, not EntityItem
};

export type SearchWeights = {
  fuzzy?: number;
  time?: number;
  brevity?: number;
};

export type SearchOptions = {
  query: string;
  limit?: number;
  weights?: SearchWeights;
  minScore?: number;
};

export type SearchResult<T extends QuickAccessItem = QuickAccessItem> = {
  item: T;
  score: number;
  scoreDetails?: {
    fuzzy: number;
    time: number;
    brevity: number;
  };
};

export type QuickAccessContextValue = {
  /**
   * Get items from specific buckets, cached and reactive.
   * Returns all items if no buckets specified.
   *
   * Performance:
   * - No buckets: O(1) - returns pre-sorted all items
   * - Single bucket: O(1) - returns pre-computed bucket list
   * - Pre-baked combo (channels, documents, messaging): O(1)
   * - Other combos: O(n+m) merge-sort of pre-sorted arrays
   *
   * @example
   * const channels = quickAccess.useList('channel', 'dm');
   * const people = quickAccess.useList('person');
   * const everything = quickAccess.useList();
   */
  useList: <B extends Bucket>(...buckets: B[]) => Accessor<QuickAccessItem[]>;

  /**
   * Whether any data sources are still loading.
   */
  isLoading: Accessor<boolean>;

  /**
   * Force refresh of all data sources.
   */
  refresh: () => void;
};

// Helper functions for QuickAccessItem

export function getItemSearchText(item: QuickAccessItem): string {
  return item.searchText;
}

export function getItemTimestamps(item: QuickAccessItem): ItemTimestamps {
  return item.timestamps;
}

export function isChannelItem(item: QuickAccessItem): boolean {
  return item.bucket === 'channel' || item.bucket === 'dm';
}
