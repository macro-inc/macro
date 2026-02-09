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
import {
  useEmails,
  type EmailEntity,
  type ChannelEntity,
  type ChatEntity,
  type DocumentEntity,
  type TaskEntity,
  type ProjectEntity,
  type EntityData,
} from '@macro-entity';
import { useHistoryQuery, type HistoryItem } from '@queries/history/history';
import { createAssertedContextProvider } from '../createContext';
import type { Item } from '@service-storage/generated/schemas/item';
import type { ChannelWithParticipants } from '@core/user';
import type {
  Bucket,
  BucketCombination,
  EntityBucket,
  EntityItem,
  UserItem,
  QuickAccessItem,
  QuickAccessContextValue,
} from './types';
import { BUCKET_COMBINATIONS } from './types';

/**
 * Maps a HistoryItem to the appropriate EntityData type.
 * Note: ownerId defaults to empty string when not available from history.
 */
function historyItemToEntity(item: HistoryItem): EntityData {
  const base = {
    id: item.id,
    name: item.name,
    ownerId: '', // Not available from history endpoint
    createdAt: item.createdAt ? new Date(item.createdAt).getTime() : undefined,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : undefined,
    viewedAt: item.viewedAt,
  };

  switch (item.type) {
    case 'chat':
      return {
        ...base,
        type: 'chat',
      } satisfies ChatEntity;

    case 'project':
      return {
        ...base,
        type: 'project',
      } satisfies ProjectEntity;

    case 'document': {
      if (item.subType?.type === 'task') {
        return {
          ...base,
          type: 'document',
          fileType: 'md',
          subType: item.subType,
        } satisfies TaskEntity;
      }
      return {
        ...base,
        type: 'document',
        fileType: item.fileType ?? undefined,
        subType: item.subType,
      } satisfies DocumentEntity;
    }

    default:
      return {
        ...base,
        type: 'document',
      } satisfies DocumentEntity;
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
    createdAt: channel.created_at
      ? new Date(channel.created_at).getTime()
      : undefined,
    updatedAt: channel.updated_at
      ? new Date(channel.updated_at).getTime()
      : undefined,
    viewedAt: channel.viewed_at
      ? new Date(channel.viewed_at).getTime()
      : undefined,
    interactedAt: channel.interacted_at
      ? new Date(channel.interacted_at).getTime()
      : undefined,
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

function getEntitySearchText(entity: EntityData): string {
  return entity.name;
}

/**
 * Parses a timestamp that could be a number or ISO string.
 */
function parseTimestamp(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
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
      const emails = useEmails();
      const augmentUserWithDmActivity = useAugmentUserWithDmActivity();

      // Build all items as a single sorted array (sorted once, filtered for buckets)
      const allItemsSorted = createLazyMemo<QuickAccessItem[]>(() => {
        const items: QuickAccessItem[] = [];

        // Process history items
        // Sort by: viewedAt ?? updatedAt (when you last interacted with it)
        const historyData = historyQuery.data ?? [];
        for (const item of historyData) {
          if (item.deletedAt) continue;

          const bucket = getBucketForHistoryItem(item);
          const entity = historyItemToEntity(item);
          const viewedAt = item.viewedAt;
          const updatedAt = parseTimestamp(item.updatedAt);
          const createdAt = parseTimestamp(item.createdAt);

          items.push({
            kind: 'entity',
            id: item.id,
            bucket,
            searchText: getEntitySearchText(entity),
            sortTimestamp: viewedAt ?? updatedAt ?? 0,
            timestamps: { viewedAt, updatedAt, createdAt },
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
          const viewedAt = parseTimestamp(channel.viewed_at) || undefined;
          const updatedAt = parseTimestamp(channel.updated_at) || undefined;
          const createdAt = parseTimestamp(channel.created_at) || undefined;

          items.push({
            kind: 'entity',
            id: channel.id,
            bucket,
            searchText: channel.name ?? '',
            sortTimestamp: updatedAt ?? 0,
            timestamps: { viewedAt, updatedAt, createdAt },
            data: entity,
          });
        }

        // Process contacts (users)
        // Sort by: lastInteraction (when you last interacted with them)
        const contactData = contacts();
        for (const contact of contactData) {
          const augmentedUser = augmentUserWithDmActivity(contact);
          const lastInteraction = augmentedUser.lastInteraction;

          items.push({
            kind: 'user',
            id: augmentedUser.id,
            bucket: 'person',
            searchText: getUserSearchText(augmentedUser),
            sortTimestamp: lastInteraction ?? 0,
            timestamps: { lastInteraction },
            data: augmentedUser,
          });
        }

        // Process emails
        // Sort by: viewedAt ?? updatedAt
        const emailData = emails();
        for (const email of emailData) {
          const viewedAt = email.viewedAt;
          const updatedAt = email.updatedAt;
          const createdAt = email.createdAt;

          items.push({
            kind: 'entity',
            id: email.id,
            bucket: 'email',
            searchText: email.name ?? 'No Subject',
            sortTimestamp: viewedAt ?? updatedAt ?? 0,
            timestamps: { viewedAt, updatedAt, createdAt },
            data: email,
          });
        }

        // Sort once by sortTimestamp descending (most recent first)
        items.sort((a, b) => b.sortTimestamp - a.sortTimestamp);

        return items;
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
      const useList = <B extends Bucket>(
        ...buckets: B[]
      ): Accessor<QuickAccessItem[]> => {
        return createMemo(() => {
          // No buckets = return all items (already sorted)
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
        // Note: channels and contacts refresh through their own mechanisms
      };

      // Compatibility layer for MentionsMenu (returns data in Entity format)
      // This matches the shape expected by mentionsUtils.ts
      type MentionEntity<K extends string, D> = {
        kind: K;
        id: string;
        data: D;
      };
      type MentionEntities = {
        users: MentionEntity<'user', IUser>[];
        items: MentionEntity<'item', Item>[];
        channels: MentionEntity<'channel', ChannelWithParticipants>[];
        emails: MentionEntity<'email', EmailEntity>[];
      };

      const mentionEntities = createMemo<MentionEntities>(() => {
        const map = bucketLists();

        // Users
        const userItems = map.get('person') ?? [];
        const users = userItems
          .filter((item): item is UserItem => item.kind === 'user')
          .map((item) => ({
            kind: 'user' as const,
            id: item.id,
            data: item.data,
          }));

        // Items (document, note, task, chat, project)
        const itemBuckets: Bucket[] = [
          'document',
          'note',
          'task',
          'chat',
          'project',
        ];
        const historyItems: MentionEntity<'item', Item>[] = [];
        for (const bucket of itemBuckets) {
          const bucketItems = map.get(bucket) ?? [];
          for (const item of bucketItems) {
            if (item.kind === 'entity') {
              // Map EntityData back to Item shape for MentionsMenu compatibility
              const entity = item.data;
              historyItems.push({
                kind: 'item',
                id: item.id,
                data: entity as unknown as Item,
              });
            }
          }
        }

        // Channels (channel + dm)
        const channelBuckets: Bucket[] = ['channel', 'dm'];
        const channelItems: MentionEntity<
          'channel',
          ChannelWithParticipants
        >[] = [];
        for (const bucket of channelBuckets) {
          const bucketItems = map.get(bucket) ?? [];
          for (const item of bucketItems) {
            if (item.kind === 'entity' && item.data.type === 'channel') {
              // Need original channel data for MentionsMenu
              const channelData = channels().find((c) => c.id === item.id);
              if (channelData) {
                channelItems.push({
                  kind: 'channel',
                  id: item.id,
                  data: channelData,
                });
              }
            }
          }
        }

        // Emails
        const emailBucketItems = map.get('email') ?? [];
        const emailItems = emailBucketItems
          .filter(
            (item): item is EntityItem<EmailEntity> =>
              item.kind === 'entity' && item.data.type === 'email'
          )
          .map((item) => ({
            kind: 'email' as const,
            id: item.id,
            data: item.data,
          }));

        return {
          users,
          items: historyItems,
          channels: channelItems,
          emails: emailItems,
        };
      });

      return {
        useList,
        isLoading,
        refresh,
        /** @deprecated Use useList instead. Compatibility layer for MentionsMenu. */
        mentionEntities,
      };
    }
  );
