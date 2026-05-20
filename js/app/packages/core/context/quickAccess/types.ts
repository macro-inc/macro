import type { IUser } from '@core/user/types';
import type { DateValue } from '@core/util/date';
import type {
  ChannelEntity,
  ChatEntity,
  DocumentEntity,
  EmailEntity,
  EntityData,
  ProjectEntity,
  TaskEntity,
} from '@entity';
import type { Accessor } from 'solid-js';

// Note (seamus) : Ideally history would return ownerId or we would get actual
//     soup entities for quick access
export type QuickAccessEntity<T extends EntityData = EntityData> = T;

export type Bucket =
  | 'channel'
  | 'dm'
  | 'person'
  | 'document'
  | 'task'
  | 'note'
  | 'chat'
  | 'project'
  | 'email';

export type EntityBucket = Exclude<Bucket, 'person'>;

const ALL_BUCKETS: Bucket[] = [
  'channel',
  'dm',
  'person',
  'document',
  'task',
  'note',
  'chat',
  'project',
  'email',
];

export type BucketCombination = 'all' | 'channels' | 'documents';

export const BUCKET_COMBINATIONS: Record<BucketCombination, Bucket[]> = {
  all: ALL_BUCKETS,
  channels: ['dm', 'channel'],
  documents: ['document', 'note', 'task', 'chat', 'project'],
};

type ItemTimestamps = {
  viewedAt?: DateValue | null;
  updatedAt?: DateValue | null;
  createdAt?: DateValue | null;
  lastInteraction?: DateValue | null;
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

export type QuickAccessItem = EntityItem | UserItem;

function _isEntityItem(item: QuickAccessItem): item is EntityItem {
  return item.kind === 'entity';
}

function _isUserItem(item: QuickAccessItem): item is UserItem {
  return item.kind === 'user';
}

function _isEntityOfType<T extends EntityData['type']>(
  item: QuickAccessItem,
  entityType: T
): item is EntityItem<Extract<EntityData, { type: T }>> {
  return item.kind === 'entity' && item.data.type === entityType;
}

function _isFromBucket<B extends Bucket>(
  item: QuickAccessItem,
  bucket: B
): boolean {
  return item.bucket === bucket;
}

/**
 * Maps a bucket to its corresponding QuickAccessItem type
 */
export type BucketItemMap = {
  channel: EntityItem<ChannelEntity>;
  dm: EntityItem<ChannelEntity>;
  document: EntityItem<DocumentEntity>;
  task: EntityItem<TaskEntity>;
  note: EntityItem<DocumentEntity>;
  chat: EntityItem<ChatEntity>;
  project: EntityItem<ProjectEntity>;
  email: EntityItem<EmailEntity>;
  person: UserItem;
};

export type ItemForBucket<B extends Bucket> = BucketItemMap[B];

export type ItemsForBuckets<Buckets extends Bucket[]> = Buckets extends [
  infer First extends Bucket,
  ...infer Rest extends Bucket[],
]
  ? ItemForBucket<First> | ItemsForBuckets<Rest>
  : never;

export type QuickAccessContextValue = {
  /**
   * Get items from specific buckets, cached and reactive.
   * Returns all items if no buckets specified.
   *
   * @example
   * const channels = quickAccess.useList('channel', 'dm');
   * const people = quickAccess.useList('person');
   * const everything = quickAccess.useList();
   */
  useList: {
    (): Accessor<QuickAccessItem[]>;
    <B extends Bucket>(...buckets: [B]): Accessor<ItemForBucket<B>[]>;
    <B extends Bucket[]>(...buckets: B): Accessor<ItemsForBuckets<B>[]>;
  };

  /**
   * Whether any data sources are still loading.
   */
  isLoading: Accessor<boolean>;

  /**
   * Force refresh of all data sources.
   */
  refresh: () => void;

  /**
   * Get a single item by ID from the cache.
   * Returns undefined if the item is not found.
   *
   * Use this for lazy lookup of full item data when you only have an ID.
   * This is more efficient than searching through lists.
   *
   * @example
   * const item = quickAccess.getById(someId);
   * if (item) {
   *   console.log(item.data);
   * }
   */
  getById: (id: string) => QuickAccessItem | undefined;
};

export function exclude(...buckets: Bucket[]) {
  return ALL_BUCKETS.filter((bucket) => !buckets.includes(bucket));
}
