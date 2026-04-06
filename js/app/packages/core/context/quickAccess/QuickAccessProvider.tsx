import type { Accessor } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import { useChannelsContext } from '@core/context/channels';
import {
  type IUser,
  useAugmentUserWithDmActivity,
  useContacts,
} from '@core/user';
import type { ApiChannelWithLatest } from '@service-comms/generated/models';
import type { ChannelEntity } from '@entity';
import { useHistoryQuery, type HistoryItem } from '@queries/history/history';
import { formatDocumentName } from '@service-storage/util/filename';
import { useRecentlyViewedSoupQuery } from '@queries/soup/recently-viewed';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { queryReadyGate } from '@queries/gate';
import type { DateValue } from '@core/util/date';
import { toDate } from 'date-fns';
import { createAssertedContextProvider } from '../createContext';
import type {
  Bucket,
  BucketCombination,
  EntityBucket,
  QuickAccessItem,
  QuickAccessContextValue,
  QuickAccessEntity,
} from './types';
import { BUCKET_COMBINATIONS } from './types';

/**
 * index entry for sorted lists.
 */
type IndexEntry = {
  id: string;
  bucket: Bucket;
  sortTimestamp: number;
};

/**
 * full item and version hash.
 */
type CacheEntry = {
  item: QuickAccessItem;
  version: string;
};

function historyItemToEntity(item: HistoryItem): QuickAccessEntity {
  const base = {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ownerId: item.ownerId,
  };

  switch (item.type) {
    case 'chat':
      return {
        ...base,
        type: 'chat',
      } as QuickAccessEntity;

    case 'project':
      return {
        ...base,
        type: 'project',
      } as QuickAccessEntity;

    case 'document': {
      const fileType =
        item.subType?.type === 'task' ? 'md' : (item.fileType ?? undefined);
      const name = formatDocumentName(item.rawName ?? item.name, fileType, {
        fullyQualifiedBlockName: true,
      });
      return {
        ...base,
        name,
        type: 'document',
        fileType,
        subType: item.subType,
      } as QuickAccessEntity;
    }

    default:
      return {
        ...base,
        type: 'document',
      } as QuickAccessEntity;
  }
}

function channelToEntity(channel: ApiChannelWithLatest): ChannelEntity {
  return {
    type: 'channel',
    id: channel.id,
    name: channel.name ?? '',
    ownerId: channel.owner_id ?? '',
    channelType: channel.channel_type ?? 'public',
    participantIds: channel.participants?.map((p) => p.user_id),
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
    viewedAt: channel.viewed_at,
    interactedAt: channel.interacted_at,
  };
}

/**
 * Determines the bucket for a history item.
 */
function getBucketForHistoryItem(item: HistoryItem): EntityBucket {
  switch (item.type) {
    case 'chat':
      return 'chat';
    case 'project':
      return 'project';
    case 'document': {
      if (item.subType?.type === 'task') return 'task';
      if (item.fileType === 'md') return 'note';
      return 'document';
    }
    default:
      return 'document';
  }
}

function getUserSearchText(user: IUser): string {
  const { email, name } = user;
  if (name === email) return `${email} | ${email}`;
  return `${name} | ${email}`;
}

function getEntitySearchText(entity: QuickAccessEntity): string {
  return entity.name;
}

function toTimestamp(value: DateValue | null | undefined): number {
  if (value == null) return 0;
  return toDate(value).getTime();
}

function getHistoryItemVersion(item: HistoryItem, viewedAt?: string): string {
  return `${item.name}|${item.updatedAt}|${viewedAt}|${item.deletedAt}`;
}

function getChannelVersion(
  channel: ApiChannelWithLatest,
  viewedAt?: string
): string {
  return `${channel.name}|${channel.updated_at}|${viewedAt}`;
}

function getUserVersion(user: IUser): string {
  return `${user.name}|${user.email}|${user.lastInteraction}`;
}

/**
 * Merge two *already* sorted index arrays into a single sorted array.
 */
function mergeSortedIndices(a: IndexEntry[], b: IndexEntry[]): IndexEntry[] {
  const result: IndexEntry[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i].sortTimestamp >= b[j].sortTimestamp) {
      result.push(a[i]);
      i++;
    } else {
      result.push(b[j]);
      j++;
    }
  }

  while (i < a.length) {
    result.push(a[i]);
    i++;
  }
  while (j < b.length) {
    result.push(b[j]);
    j++;
  }

  return result;
}

/**
 * Merge multiple *already* sorted index arrays into a single sorted array.
 */
function mergeMultipleSortedIndices(arrays: IndexEntry[][]): IndexEntry[] {
  if (arrays.length === 0) return [];
  if (arrays.length === 1) return arrays[0];
  return arrays.reduce((acc, arr) => mergeSortedIndices(acc, arr));
}

export const [QuickAccessProvider, useQuickAccess] =
  createAssertedContextProvider(
    'QuickAccessContext',
    (): QuickAccessContextValue => {
      // queries
      const historyQuery = useHistoryQuery();
      const { channels, isLoading: channelsLoading } = useChannelsContext();
      const contacts = useContacts();
      const augmentUserWithDmActivity = useAugmentUserWithDmActivity();
      const instructionsIdQuery = useInstructionsMdIdQuery();

      // globally hidden ids
      const [hiddenIds, setHiddenIds] = createSignal<Set<string>>(new Set());

      const hideId = (id: string) => {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      };

      // instructions.md effect
      createEffect(() => {
        const instructionsReady = queryReadyGate(instructionsIdQuery);
        if (!instructionsReady) return;
        const instructionsId = instructionsIdQuery.data;
        if (!instructionsId) return;
        hideId(instructionsId);
      });

      // stable cache for transformed items
      const itemCache = new Map<string, CacheEntry>();

      const recentlyViewedQuery = useRecentlyViewedSoupQuery();

      const soupViewedAtMap = createLazyMemo(() => {
        const map = new Map<string, string>();
        const data = recentlyViewedQuery.data;
        if (!data) return map;
        for (const item of data) {
          if (item.viewedAt) map.set(item.id, item.viewedAt);
        }
        return map;
      });

      const processedData = createLazyMemo(() => {
        const viewedAtMap = soupViewedAtMap();
        const seenIds = new Set<string>();
        const allEntries: IndexEntry[] = [];

        const transformedItems: Array<{
          id: string;
          name: string;
          type: string;
          reason: string;
        }> = [];

        // Process history items
        const historyData = historyQuery.data ?? [];
        const hidden = hiddenIds();
        for (const item of historyData) {
          if (item.deletedAt) continue;
          if (hidden.has(item.id)) continue;
          seenIds.add(item.id);

          const viewedAt = viewedAtMap.get(item.id);

          const version = getHistoryItemVersion(item, viewedAt);
          const cached = itemCache.get(item.id);

          if (!cached || cached.version !== version) {
            const reason = !cached
              ? 'new'
              : `changed (${cached.version} -> ${version})`;
            transformedItems.push({
              id: item.id,
              name: item.name,
              type: `history:${item.type}`,
              reason,
            });
            const bucket = getBucketForHistoryItem(item);
            const entity = {
              ...historyItemToEntity(item),
              viewedAt,
            };
            const viewedAtMs = toTimestamp(viewedAt);
            const updatedAtMs = toTimestamp(item.updatedAt);
            const sortTimestamp = viewedAtMs || updatedAtMs;

            const quickAccessItem: QuickAccessItem = {
              kind: 'entity',
              id: item.id,
              bucket,
              searchText: getEntitySearchText(entity),
              sortTimestamp,
              timestamps: {
                viewedAt,
                updatedAt: item.updatedAt,
                createdAt: item.createdAt,
              },
              data: entity,
            };

            itemCache.set(item.id, { item: quickAccessItem, version });
            allEntries.push({ id: item.id, bucket, sortTimestamp });
          } else {
            allEntries.push({
              id: item.id,
              bucket: cached.item.bucket,
              sortTimestamp: cached.item.sortTimestamp,
            });
          }
        }

        // Process channels
        const channelData = channels();
        for (const channel of channelData) {
          seenIds.add(channel.id);

          const viewedAt =
            viewedAtMap.get(channel.id) ?? channel.viewed_at ?? undefined;

          const version = getChannelVersion(channel, viewedAt);
          const cached = itemCache.get(channel.id);

          if (!cached || cached.version !== version) {
            const reason = !cached
              ? 'new'
              : `changed (${cached.version} -> ${version})`;
            transformedItems.push({
              id: channel.id,
              name: channel.name ?? '',
              type: `channel:${channel.channel_type}`,
              reason,
            });
            const isDm = channel.channel_type === 'direct_message';
            const bucket: Bucket = isDm ? 'dm' : 'channel';
            const entity = {
              ...channelToEntity(channel),
              viewedAt,
            };
            const viewedAtMs = toTimestamp(viewedAt);
            const updatedAtMs = toTimestamp(channel.updated_at);
            const sortTimestamp = viewedAtMs || updatedAtMs;

            const quickAccessItem: QuickAccessItem = {
              kind: 'entity',
              id: channel.id,
              bucket,
              searchText: channel.name ?? '',
              sortTimestamp,
              timestamps: {
                viewedAt,
                updatedAt: channel.updated_at,
                createdAt: channel.created_at,
              },
              data: entity,
            };

            itemCache.set(channel.id, { item: quickAccessItem, version });
            allEntries.push({ id: channel.id, bucket, sortTimestamp });
          } else {
            allEntries.push({
              id: channel.id,
              bucket: cached.item.bucket,
              sortTimestamp: cached.item.sortTimestamp,
            });
          }
        }

        // Process contacts (users)
        const contactData = contacts();
        for (const contact of contactData) {
          const augmentedUser = augmentUserWithDmActivity(contact);
          seenIds.add(augmentedUser.id);

          const version = getUserVersion(augmentedUser);
          const cached = itemCache.get(augmentedUser.id);

          if (!cached || cached.version !== version) {
            const reason = !cached
              ? 'new'
              : `changed (${cached.version} -> ${version})`;
            transformedItems.push({
              id: augmentedUser.id,
              name: augmentedUser.name,
              type: 'user',
              reason,
            });
            const sortTimestamp = toTimestamp(augmentedUser.lastInteraction);

            const quickAccessItem: QuickAccessItem = {
              kind: 'user',
              id: augmentedUser.id,
              bucket: 'person',
              searchText: getUserSearchText(augmentedUser),
              sortTimestamp,
              timestamps: {
                lastInteraction: augmentedUser.lastInteraction,
              },
              data: augmentedUser,
            };

            itemCache.set(augmentedUser.id, { item: quickAccessItem, version });
            allEntries.push({
              id: augmentedUser.id,
              bucket: 'person',
              sortTimestamp,
            });
          } else {
            allEntries.push({
              id: augmentedUser.id,
              bucket: cached.item.bucket,
              sortTimestamp: cached.item.sortTimestamp,
            });
          }
        }

        // Clean up stale cache entries (items that no longer exist)
        for (const id of itemCache.keys()) {
          if (!seenIds.has(id)) {
            itemCache.delete(id);
          }
        }

        // Sort all entries by timestamp descending
        allEntries.sort((a, b) => b.sortTimestamp - a.sortTimestamp);

        // Deduplicate by id - keep the first occurrence (most recent timestamp)
        const deduplicatedEntries: IndexEntry[] = [];
        const dedupeSet = new Set<string>();
        for (const entry of allEntries) {
          if (!dedupeSet.has(entry.id)) {
            dedupeSet.add(entry.id);
            deduplicatedEntries.push(entry);
          }
        }

        return deduplicatedEntries;
      });

      const getById = (id: string): QuickAccessItem | undefined => {
        return itemCache.get(id)?.item;
      };

      const resolveEntries = (entries: IndexEntry[]): QuickAccessItem[] => {
        const result: QuickAccessItem[] = [];
        for (const entry of entries) {
          const cached = itemCache.get(entry.id);
          if (cached) {
            result.push(cached.item);
          }
        }
        return result;
      };

      // Pre-compute individual bucket index lists (each already sorted)
      const bucketIndices = createLazyMemo<Map<Bucket, IndexEntry[]>>(() => {
        const map = new Map<Bucket, IndexEntry[]>();
        for (const entry of processedData()) {
          const list = map.get(entry.bucket);
          if (list) {
            list.push(entry);
          } else {
            map.set(entry.bucket, [entry]);
          }
        }
        return map;
      });

      const preBakedIndices = createLazyMemo<
        Record<BucketCombination, IndexEntry[]>
      >(() => {
        const indices = bucketIndices();
        return {
          all: processedData(),
          channels: mergeMultipleSortedIndices([
            indices.get('dm') ?? [],
            indices.get('channel') ?? [],
          ]),
          documents: mergeMultipleSortedIndices([
            indices.get('document') ?? [],
            indices.get('note') ?? [],
            indices.get('task') ?? [],
            indices.get('chat') ?? [],
            indices.get('project') ?? [],
          ]),
        };
      });

      // helper to get a pre-baked index list if the bucket combination matches
      const getPreBakedIndices = (
        buckets: Bucket[]
      ): IndexEntry[] | undefined => {
        const baked = preBakedIndices();
        const bucketSet = new Set(buckets);

        for (const [name, combo] of Object.entries(BUCKET_COMBINATIONS)) {
          if (
            combo.length === buckets.length &&
            combo.every((b) => bucketSet.has(b))
          ) {
            return baked[name as BucketCombination];
          }
        }
        return undefined;
      };

      // API: useList
      // Optimized for common cases:
      // 1. No buckets = return pre-sorted all items list
      // 2. Single bucket = return pre-computed bucket list
      // 3. Pre-baked combination = return pre-merged list
      // 4. Other combinations = merge-sort bucket lists
      //
      // Items are resolved lazily
      const useList = <B extends Bucket>(...buckets: B[]): Accessor<any> => {
        return createLazyMemo(() => {
          let indices: IndexEntry[];

          if (buckets.length === 0) {
            indices = preBakedIndices().all;
          } else if (buckets.length === 1) {
            // Single bucket = return pre-computed bucket list
            indices = bucketIndices().get(buckets[0]) ?? [];
          } else {
            // Check for pre-baked combination
            const preBaked = getPreBakedIndices(buckets);
            if (preBaked) {
              indices = preBaked;
            } else {
              // Fallback: merge-sort the requested bucket index lists
              const allIndices = bucketIndices();
              const indicesToMerge = buckets
                .map((b) => allIndices.get(b) ?? [])
                .filter((arr) => arr.length > 0);
              indices = mergeMultipleSortedIndices(indicesToMerge);
            }
          }

          return resolveEntries(indices);
        });
      };

      const isLoading = () => historyQuery.isLoading || channelsLoading();

      const refresh = () => {
        historyQuery.refetch();
      };

      return {
        useList,
        isLoading,
        refresh,
        getById,
      };
    }
  );
