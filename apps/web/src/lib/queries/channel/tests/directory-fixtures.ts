import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { SearchCacheArgs, SearchCachePage } from '@graphql-cache/protocol';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import type { ChannelDirectoryFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { vi } from 'vitest';

const CREATED = '2026-11-01T00:00:00+00:00';

/** A cached channel record with every directory field. */
export function channelRecord(
  id: string,
  overrides: Partial<ChannelDirectoryFieldsFragment> = {}
): ChannelDirectoryFieldsFragment {
  return {
    __typename: 'GraphqlSoupChannel',
    id,
    name: `channel ${id}`,
    channelType: 'PUBLIC',
    ownerId: 'macro|owner@example.com',
    organizationId: '7',
    teamId: null,
    autoJoinTeam: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    viewedAt: null,
    interactedAt: null,
    isParticipant: true,
    frecencyScore: null,
    participants: [
      {
        channelId: id,
        userId: 'macro|owner@example.com',
        role: 'OWNER',
        joinedAt: CREATED,
        leftAt: null,
      },
    ],
    botParticipants: [],
    agentDm: null,
    latestMessage: null,
    latestNonThreadMessage: null,
    ...overrides,
  };
}

/** The same channel as the REST list returns it. */
export function restChannel(
  id: string,
  overrides: Partial<ApiChannelWithLatest> = {}
): ApiChannelWithLatest {
  return {
    id,
    name: `channel ${id}`,
    channel_type: 'public',
    owner_id: 'macro|owner@example.com',
    org_id: 7,
    team_id: null,
    auto_join_team: false,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    is_participant: true,
    participants: [
      {
        channel_id: id,
        user_id: 'macro|owner@example.com',
        role: 'owner',
        joined_at: '2026-11-01T00:00:00Z',
        left_at: null,
      },
    ],
    latest_message: null,
    latest_non_thread_message: null,
    ...overrides,
  } as ApiChannelWithLatest;
}

type StoredRecord = {
  record: ChannelDirectoryFieldsFragment | Record<string, unknown>;
  sourceHash: string;
  timestampMs: number;
  /** Omitted from directory reads, as a record missing a field is. */
  incomplete?: boolean;
};

/**
 * A cache with a search projection over its channel records, ordered newest
 * first like the engine's, and record reads by key.
 */
export function fakeChannelCache() {
  const records = new Map<string, StoredRecord>();
  const host = {
    search: vi.fn(async (args: SearchCacheArgs): Promise<SearchCachePage> => {
      const sorted = [...records]
        .map(([recordKey, stored]) => ({ recordKey, ...stored }))
        .sort(
          (left, right) =>
            right.timestampMs - left.timestampMs ||
            left.recordKey.localeCompare(right.recordKey)
        );
      const cursor = args.cursor;
      const after = cursor
        ? sorted.filter(
            (row) =>
              row.timestampMs < cursor.timestampMs ||
              (row.timestampMs === cursor.timestampMs &&
                row.recordKey.localeCompare(cursor.recordKey) > 0)
          )
        : sorted;
      const page = after.slice(0, args.limit);
      const last = page.at(-1);
      return {
        documents: page.map((row) => ({
          profile: 'quick-access-v1',
          recordKey: row.recordKey,
          bucket: 'channel',
          searchText: '',
          timestampMs: row.timestampMs,
          sourceHash: row.sourceHash,
        })),
        nextCursor:
          last && after.length > page.length
            ? { timestampMs: last.timestampMs, recordKey: last.recordKey }
            : null,
      };
    }),
    readRecordsByKeys: vi.fn<CacheHost['readRecordsByKeys']>(
      async ({ keys }) => ({
        revision: INITIAL_CACHE_REVISION,
        records: keys.flatMap((recordKey) => {
          const stored = records.get(recordKey);
          if (!stored || stored.incomplete) return [];
          return [{ recordKey, record: stored.record }];
        }),
      })
    ),
  };

  return {
    host,
    records,
    put(
      record: ChannelDirectoryFieldsFragment,
      options: Partial<Omit<StoredRecord, 'record'>> = {}
    ) {
      records.set(`GraphqlSoupChannel:${record.id}`, {
        record,
        sourceHash: options.sourceHash ?? `hash-${record.id}`,
        timestampMs: options.timestampMs ?? 0,
        incomplete: options.incomplete,
      });
    },
  };
}
