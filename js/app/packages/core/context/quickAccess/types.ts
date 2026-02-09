import type { Accessor } from 'solid-js';
import type { ChannelWithParticipants, IUser } from '@core/user';
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
import type { Item } from '@service-storage/generated/schemas/item';

// =============================================================================
// Buckets
// =============================================================================

/**
 * Buckets represent logical groupings of items for quick access.
 * Consumers can request specific buckets via useList() or useSearch().
 */
export type Bucket =
  | 'channel' // public/org channels
  | 'dm' // direct message channels
  | 'person' // contacts/users
  | 'document' // non-task documents
  | 'task' // task documents
  | 'note' // markdown notes (non-task)
  | 'chat' // chat threads
  | 'project' // folders/projects
  | 'email' // email threads
  | 'command'; // hotkey commands

/** Buckets that contain EntityData items */
export type EntityBucket = Exclude<Bucket, 'person' | 'command'>;

/** All buckets as an array for iteration */
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

// =============================================================================
// Pre-baked Bucket Combinations
// =============================================================================

/** Common bucket combinations that are pre-computed for performance */
export type BucketCombination =
  | 'all' // Everything
  | 'channels' // dm + channel
  | 'documents' // document + note + task + chat + project
  | 'messaging'; // dm + channel + person

/** Map of combination names to their constituent buckets */
export const BUCKET_COMBINATIONS: Record<BucketCombination, Bucket[]> = {
  all: ALL_BUCKETS,
  channels: ['dm', 'channel'],
  documents: ['document', 'note', 'task', 'chat', 'project'],
  messaging: ['dm', 'channel', 'person'],
};

// =============================================================================
// Quick Access Items (Discriminated Union)
// =============================================================================

/** Timestamp fields preserved for display and flexible sorting */
export type ItemTimestamps = {
  /** When the item was last viewed by the user */
  viewedAt?: number;
  /** When the item was last updated (e.g., last message for channels) */
  updatedAt?: number;
  /** When the item was created */
  createdAt?: number;
  /** For users: last interaction timestamp */
  lastInteraction?: number;
};

/** Base properties shared by all quick access items */
type QuickAccessBase = {
  id: string;
  searchText: string;
  /**
   * Computed sort timestamp based on bucket-specific logic.
   * - DMs/Channels: updatedAt (most recent message)
   * - Documents/Notes: viewedAt ?? updatedAt
   * - Users: lastInteraction
   * - Commands: 0 (sort by displayPriority instead)
   */
  sortTimestamp: number;
  /** Original timestamps preserved for display */
  timestamps: ItemTimestamps;
};

/** Entity-based items (documents, channels, emails, etc.) */
export type EntityItem<T extends EntityData = EntityData> = QuickAccessBase & {
  kind: 'entity';
  bucket: EntityBucket;
  data: T;
};

/** User/contact items */
export type UserItem = QuickAccessBase & {
  kind: 'user';
  bucket: 'person';
  data: IUser;
};

/** Command items */
export type CommandItem = QuickAccessBase & {
  kind: 'command';
  bucket: 'command';
  data: HotkeyCommand;
};

/** The unified quick access item type */
export type QuickAccessItem = EntityItem | UserItem | CommandItem;

// =============================================================================
// Type Guards
// =============================================================================

export function isEntityItem(item: QuickAccessItem): item is EntityItem {
  return item.kind === 'entity';
}

export function isUserItem(item: QuickAccessItem): item is UserItem {
  return item.kind === 'user';
}

export function isCommandItem(item: QuickAccessItem): item is CommandItem {
  return item.kind === 'command';
}

/** Type guard for specific entity types */
export function isEntityOfType<T extends EntityData['type']>(
  item: QuickAccessItem,
  entityType: T
): item is EntityItem<Extract<EntityData, { type: T }>> {
  return item.kind === 'entity' && item.data.type === entityType;
}

/** Check if item is from a specific bucket */
export function isFromBucket<B extends Bucket>(
  item: QuickAccessItem,
  bucket: B
): boolean {
  return item.bucket === bucket;
}

// =============================================================================
// Entity Type Helpers
// =============================================================================

/** Map from bucket to the expected EntityData type */
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

// =============================================================================
// Search Configuration
// =============================================================================

export type SearchWeights = {
  /** Weight for fuzzy text matching (0-1). Default: 0.7 */
  fuzzy?: number;
  /** Weight for recency/time score (0-1). Default: 0.3 */
  time?: number;
  /** Weight for shorter names (0-1). Default: 0 */
  brevity?: number;
};

export type SearchOptions = {
  /** Search query string */
  query: string;
  /** Maximum number of results. Default: 50 */
  limit?: number;
  /** Scoring weights override */
  weights?: SearchWeights;
  /** Minimum fuzzy score threshold (0-1). Default: 0.1 */
  minScore?: number;
};

export type SearchResult<T extends QuickAccessItem = QuickAccessItem> = {
  item: T;
  score: number;
  /** Breakdown of how the score was computed */
  scoreDetails?: {
    fuzzy: number;
    time: number;
    brevity: number;
  };
};

// =============================================================================
// Context API
// =============================================================================

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

  /**
   * @deprecated Use useList instead. Compatibility layer for MentionsMenu.
   * Returns data in the Entity format expected by mentionsUtils.ts
   */
  mentionEntities: Accessor<MentionEntities>;
};

// =============================================================================
// Compatibility Types (for MentionsMenu migration)
// =============================================================================

/** Entity format used by MentionsMenu */
export type MentionEntity<K extends string, D> = {
  kind: K;
  id: string;
  data: D;
};

/** Collection of mention entities for MentionsMenu compatibility */
export type MentionEntities = {
  users: MentionEntity<'user', IUser>[];
  items: MentionEntity<'item', Item>[];
  channels: MentionEntity<'channel', ChannelWithParticipants>[];
  emails: MentionEntity<'email', EmailEntity>[];
};

// =============================================================================
// Search Helpers (for components composing their own search)
// =============================================================================

/**
 * Extract timestamps from a QuickAccessItem for use with freshSearch.
 * Use this as the getTimestamp parameter when creating a fresh search.
 *
 * @example
 * const search = createFreshSearch(
 *   config,
 *   (item) => item.searchText,
 *   (item) => item.bucket === 'channel' || item.bucket === 'dm',
 *   getItemTimestamps
 * );
 */
export function getItemTimestamps(item: QuickAccessItem) {
  return {
    viewedAt: item.timestamps.viewedAt,
    updatedAt: item.timestamps.updatedAt,
    lastInteraction: item.timestamps.lastInteraction,
  };
}

/**
 * Get search text from a QuickAccessItem.
 * Use this as the getName parameter when creating a fresh search.
 */
export function getItemSearchText(item: QuickAccessItem): string {
  return item.searchText;
}

/**
 * Check if item is a channel (dm or channel bucket).
 * Use this as the isChannelItem parameter when creating a fresh search.
 */
export function isChannelItem(item: QuickAccessItem): boolean {
  return item.bucket === 'channel' || item.bucket === 'dm';
}
