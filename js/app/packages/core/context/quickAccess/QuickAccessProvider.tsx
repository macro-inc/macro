import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
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

function historyItemToEntity(item: HistoryItem): QuickAccessEntity {
  const base = {
    id: item.id,
    name: item.name,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    viewedAt: item.viewedAt,
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
      if (item.subType?.type === 'task') {
        return {
          ...base,
          type: 'document',
          fileType: 'md',
          subType: item.subType,
        } as QuickAccessEntity;
      }
      return {
        ...base,
        type: 'document',
        fileType: item.fileType ?? undefined,
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

/**
 * Maps an ApiChannelWithLatest to ChannelEntity.
 */
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

/**
 * Converts a DateValue to a timestamp number for sorting.
 */
function toTimestamp(value: DateValue | null | undefined): number {
  if (value == null) return 0;
  return toDate(value).getTime();
}

/**
 * Merge two *already* sorted arrays into a single sorted array.
 */
function mergeSorted(
  a: QuickAccessItem[],
  b: QuickAccessItem[]
): QuickAccessItem[] {
  const result: QuickAccessItem[] = [];
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
 * Merge multiple *already* sorted arrays into a single sorted array.
 */
function mergeMultipleSorted(arrays: QuickAccessItem[][]): QuickAccessItem[] {
  if (arrays.length === 0) return [];
  if (arrays.length === 1) return arrays[0];
  return arrays.reduce((acc, arr) => mergeSorted(acc, arr));
}

export const [QuickAccessProvider, useQuickAccess] =
  createAssertedContextProvider(
    'QuickAccessContext',
    (): QuickAccessContextValue => {
      const historyQuery = useHistoryQuery();
      const { channels, isLoading: channelsLoading } = useChannelsContext();
      const contacts = useContacts();
      const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

      const allItemsSorted = createLazyMemo<QuickAccessItem[]>(() => {
        const startAllItems = performance.now();
        const items: QuickAccessItem[] = [];

        // Process history items
        // Sort by: viewedAt ?? updatedAt (when you last interacted with it)
        const historyData = historyQuery.data ?? [];
        for (const item of historyData) {
          // no deleted items
          if (item.deletedAt) continue;

          const bucket = getBucketForHistoryItem(item);
          const entity = historyItemToEntity(item);
          const viewedAtMs = toTimestamp(item.viewedAt);
          const updatedAtMs = toTimestamp(item.updatedAt);

          items.push({
            kind: 'entity',
            id: item.id,
            bucket,
            searchText: getEntitySearchText(entity),
            sortTimestamp: viewedAtMs || updatedAtMs,
            timestamps: {
              viewedAt: item.viewedAt,
              updatedAt: item.updatedAt,
              createdAt: item.createdAt,
            },
            data: entity,
          });
        }

        // Process channels
        // Sort by: updatedAt (most recent message)
        const channelData = channels();
        for (const channel of channelData) {
          const isDm = channel.channel_type === 'direct_message';
          const bucket: Bucket = isDm ? 'dm' : 'channel';
          const entity = channelToEntity(channel);
          const updatedAtMs = toTimestamp(channel.updated_at);

          items.push({
            kind: 'entity',
            id: channel.id,
            bucket,
            searchText: channel.name ?? '',
            sortTimestamp: updatedAtMs,
            timestamps: {
              viewedAt: channel.viewed_at,
              updatedAt: channel.updated_at,
              createdAt: channel.created_at,
            },
            data: entity,
          });
        }

        // Process contacts (users)
        // Sort by: lastInteraction (when you last interacted with them)
        const contactData = contacts();
        for (const contact of contactData) {
          const augmentedUser = augmentUserWithDmActivity(contact);
          const lastInteractionMs = toTimestamp(augmentedUser.lastInteraction);

          items.push({
            kind: 'user',
            id: augmentedUser.id,
            bucket: 'person',
            searchText: getUserSearchText(augmentedUser),
            sortTimestamp: lastInteractionMs,
            timestamps: {
              lastInteraction: augmentedUser.lastInteraction,
            },
            data: augmentedUser,
          });
        }

        // Sort once by sortTimestamp descending (most recent first)
        items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);

        // Deduplicate by id - keep the first occurrence (most recent timestamp)
        const seenIds = new Set<string>();
        const deduplicated: QuickAccessItem[] = [];
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            deduplicated.push(item);
          }
        }

        console.log(
          `All items sorted and deduplicated in ${performance.now() - startAllItems}ms (${items.length} -> ${deduplicated.length} items)`
        );
        return deduplicated;
      });

      // Pre-compute individual bucket lists (each already sorted since we iterate in order)
      const bucketLists = createLazyMemo<Map<Bucket, QuickAccessItem[]>>(() => {
        const map = new Map<Bucket, QuickAccessItem[]>();
        for (const item of allItemsSorted()) {
          const list = map.get(item.bucket);
          if (list) {
            list.push(item);
          } else {
            map.set(item.bucket, [item]);
          }
        }
        return map;
      });

      // Pre-bake common bucket combinations for O(1) access
      const preBakedLists = createLazyMemo<
        Record<BucketCombination, QuickAccessItem[]>
      >(() => {
        const lists = bucketLists();
        return {
          all: allItemsSorted(),
          channels: mergeMultipleSorted([
            lists.get('dm') ?? [],
            lists.get('channel') ?? [],
          ]),
          documents: mergeMultipleSorted([
            lists.get('document') ?? [],
            lists.get('note') ?? [],
            lists.get('task') ?? [],
            lists.get('chat') ?? [],
            lists.get('project') ?? [],
          ]),
          messaging: mergeMultipleSorted([
            lists.get('dm') ?? [],
            lists.get('channel') ?? [],
            lists.get('person') ?? [],
          ]),
        };
      });

      // Helper to get a pre-baked list if the bucket combination matches
      const getPreBakedList = (
        buckets: Bucket[]
      ): QuickAccessItem[] | undefined => {
        const baked = preBakedLists();
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
      // 1. No buckets = return pre-sorted all items list (O(1))
      // 2. Single bucket = return pre-computed bucket list (O(1))
      // 3. Pre-baked combination = return pre-merged list (O(1))
      // 4. Other combinations = merge-sort bucket lists (O(n+m))
      const useList = <B extends Bucket>(...buckets: B[]): Accessor<any> => {
        return createMemo(() => {
          if (buckets.length === 0) {
            return preBakedLists().all;
          }

          // Single bucket = return pre-computed bucket list
          if (buckets.length === 1) {
            return bucketLists().get(buckets[0]) ?? [];
          }

          // Check for pre-baked combination
          const preBaked = getPreBakedList(buckets);
          if (preBaked) {
            return preBaked;
          }

          // Fallback: merge-sort the requested bucket lists
          const lists = bucketLists();
          const bucketsToMerge = buckets
            .map((b) => lists.get(b) ?? [])
            .filter((arr) => arr.length > 0);
          return mergeMultipleSorted(bucketsToMerge);
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
      };
    }
  );
