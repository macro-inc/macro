import { itemToSafeName } from '@core/constant/allBlocks';
import {
  useChannelsContext,
  useDmActivityByUserId,
} from '@core/context/channels';
import {
  type IUser,
  useContacts,
  useIsConnectedSecondaryInbox,
} from '@core/user';
import type { DateValue } from '@core/util/date';
import type {
  ChannelEntity,
  CrmCompanyEntity,
  SkillEntity,
  SnippetEntity,
} from '@entity';
import { useCachedGraphqlChannelsQuery } from '@queries/channel/channels';
import {
  type CachedGraphqlChannel,
  materializeCachedGraphqlChannels,
} from '@queries/channel/graphql';
import { queryReadyGate } from '@queries/gate';
import { materializeCachedGraphqlHistoryItems } from '@queries/history/graphql';
import { type HistoryItem, useHistoryQuery } from '@queries/history/history';
import { useQuickAccessCrmCompaniesQuery } from '@queries/soup/quick-access-crm-companies';
import { useQuickAccessSkillsQuery } from '@queries/soup/quick-access-skills';
import { useQuickAccessSnippetsQuery } from '@queries/soup/quick-access-snippets';
import { useRecentlyViewedSoupQuery } from '@queries/soup/recently-viewed';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { formatDocumentName } from '@service-storage/util/filename';
import { createLazyMemo } from '@solid-primitives/memo';
import { toDate } from 'date-fns';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { searchQuickAccessItems } from './entity-search';
import type {
  Bucket,
  BucketCombination,
  EntityBucket,
  QuickAccessContextValue,
  QuickAccessEntity,
  QuickAccessItem,
  QuickAccessList,
  QuickAccessListOptions,
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
      const fileType = item.fileType ?? undefined;
      const subType = item.subType ?? undefined;
      const name = formatDocumentName(
        itemToSafeName({
          name: item.rawName ?? item.name,
          type: item.type,
          fileType,
          subType,
        }),
        fileType,
        {
          fullyQualifiedBlockName: true,
        }
      );
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

function apiChannelToQuickAccessChannel(
  channel: ApiChannelWithLatest
): CachedGraphqlChannel {
  return {
    id: channel.id,
    name: channel.name ?? '',
    ownerId: channel.owner_id ?? '',
    channelType: channel.channel_type ?? 'public',
    participantIds: channel.participants?.map((p) => p.user_id) ?? [],
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
    viewedAt: channel.viewed_at ?? undefined,
    interactedAt: channel.interacted_at ?? undefined,
  };
}

function channelToEntity(channel: CachedGraphqlChannel): ChannelEntity {
  return {
    type: 'channel',
    id: channel.id,
    name: channel.name,
    ownerId: channel.ownerId,
    channelType: channel.channelType,
    participantIds: channel.participantIds,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    viewedAt: channel.viewedAt,
    interactedAt: channel.interactedAt,
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
      if (item.subType?.type === 'snippet') return 'snippet';
      if (item.subType?.type === 'skill') return 'skill';
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

function channelToQuickAccessItem(
  channel: CachedGraphqlChannel,
  sortTimestamp = toTimestamp(channel.viewedAt) ||
    toTimestamp(channel.updatedAt)
): QuickAccessItem {
  const bucket: Bucket =
    channel.channelType === 'direct_message' ? 'dm' : 'channel';
  return {
    kind: 'entity',
    id: channel.id,
    bucket,
    searchText: channel.name,
    sortTimestamp,
    timestamps: {
      viewedAt: channel.viewedAt,
      updatedAt: channel.updatedAt,
      createdAt: channel.createdAt,
    },
    data: channelToEntity(channel),
  };
}

function equalActivityMaps(
  previous: Map<string, DateValue>,
  next: Map<string, DateValue>
): boolean {
  if (previous.size !== next.size) return false;
  for (const [id, value] of previous) {
    if (!next.has(id)) return false;
    if (toTimestamp(value) !== toTimestamp(next.get(id))) return false;
  }
  return true;
}

function getHistoryItemVersion(item: HistoryItem, viewedAt?: string): string {
  return `${item.name}|${item.updatedAt}|${viewedAt}|${item.deletedAt}`;
}

function getChannelVersion(
  channel: CachedGraphqlChannel,
  viewedAt?: string
): string {
  return `${channel.name}|${channel.updatedAt}|${viewedAt}`;
}

function getUserVersion(
  user: IUser,
  lastInteraction: DateValue | undefined
): string {
  return `${user.name}|${user.email}|${lastInteraction}`;
}

function getCrmCompanySearchText(company: CrmCompanyEntity): string {
  const domains = company.domains.map((d) => d.domain).join(' ');
  return domains ? `${company.name} | ${domains}` : company.name;
}

function getCrmCompanyVersion(
  company: CrmCompanyEntity,
  viewedAt?: string
): string {
  const domains = company.domains.map((d) => d.domain).join(',');
  return `${company.name}|${domains}|${company.updatedAt}|${viewedAt}`;
}

function getSnippetVersion(snippet: SnippetEntity, viewedAt?: string): string {
  return `${snippet.name}|${snippet.updatedAt}|${viewedAt}`;
}

function getSkillVersion(skill: SkillEntity, viewedAt?: string): string {
  return `${skill.name}|${skill.updatedAt}|${viewedAt}`;
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

function sortIndexEntries(entries: IndexEntry[]): IndexEntry[] {
  entries.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  return entries;
}

/** Builds Quick Access from history and its supporting entity sources. */
export function createQuickAccessValue(): QuickAccessContextValue {
  // queries
  const historyQuery = useHistoryQuery();
  const { channels, isLoading: channelsLoading } = useChannelsContext();
  const contacts = useContacts();
  const rawDmActivityByUserId = useDmActivityByUserId();
  const dmActivityByUserId = createMemo(rawDmActivityByUserId, undefined, {
    equals: equalActivityMaps,
  });
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();
  const graphqlCacheHost = getGraphqlSoupCacheHost();
  const cacheHost = graphqlCacheHost?.disabled ? undefined : graphqlCacheHost;
  const [cacheRevision, setCacheRevision] = createSignal(0);
  const cachedChannelsQuery = useCachedGraphqlChannelsQuery(cacheHost);
  const unsubscribeCacheChanges = cacheHost?.onCacheChanged(() => {
    setCacheRevision((revision) => revision + 1);
    void cachedChannelsQuery.refetch();
  });
  onCleanup(() => unsubscribeCacheChanges?.());
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const { query: crmCompaniesQuery, companies: crmCompaniesAccessor } =
    useQuickAccessCrmCompaniesQuery();
  const { query: snippetsQuery, snippets: snippetsAccessor } =
    useQuickAccessSnippetsQuery();
  const { query: skillsQuery, skills: skillsAccessor } =
    useQuickAccessSkillsQuery();

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

  const historyEntries = createLazyMemo(() => {
    const viewedAtMap = soupViewedAtMap();
    const seenIds = new Set<string>();
    const allEntries: IndexEntry[] = [];

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

    return {
      entries: sortIndexEntries(allEntries),
      ids: seenIds,
    };
  });

  const channelEntries = createLazyMemo(() => {
    const viewedAtMap = soupViewedAtMap();
    const allEntries: IndexEntry[] = [];

    // The GraphQL cache is authoritative while enabled. Otherwise preserve the
    // existing channel-list source unchanged.
    const channelData = cacheHost
      ? (cachedChannelsQuery.data ?? [])
      : channels().map(apiChannelToQuickAccessChannel);
    for (const sourceChannel of channelData) {
      const viewedAt = cacheHost
        ? sourceChannel.viewedAt
        : (viewedAtMap.get(sourceChannel.id) ?? sourceChannel.viewedAt);
      const channel = { ...sourceChannel, viewedAt };
      const version = getChannelVersion(channel, viewedAt);
      const cached = itemCache.get(channel.id);

      if (!cached || cached.version !== version) {
        const quickAccessItem = channelToQuickAccessItem(channel);
        itemCache.set(channel.id, { item: quickAccessItem, version });
        allEntries.push({
          id: channel.id,
          bucket: quickAccessItem.bucket,
          sortTimestamp: quickAccessItem.sortTimestamp,
        });
      } else {
        allEntries.push({
          id: channel.id,
          bucket: cached.item.bucket,
          sortTimestamp: cached.item.sortTimestamp,
        });
      }
    }

    return sortIndexEntries(allEntries);
  });

  const contactEntries = createLazyMemo(() => {
    const activityByUserId = dmActivityByUserId();
    const allEntries: IndexEntry[] = [];

    // Process contacts (users)
    const contactData = contacts();
    for (const contact of contactData) {
      if (isConnectedSecondaryInbox(contact.id)) continue;
      const lastInteraction = activityByUserId.get(contact.id);

      const version = getUserVersion(contact, lastInteraction);
      const cached = itemCache.get(contact.id);

      if (!cached || cached.version !== version) {
        const augmentedUser = { ...contact, lastInteraction };
        const sortTimestamp = toTimestamp(lastInteraction);

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
          id: contact.id,
          bucket: cached.item.bucket,
          sortTimestamp: cached.item.sortTimestamp,
        });
      }
    }

    return sortIndexEntries(allEntries);
  });

  const crmCompanyEntries = createLazyMemo(() => {
    const viewedAtMap = soupViewedAtMap();
    const allEntries: IndexEntry[] = [];
    const hidden = hiddenIds();

    // Process CRM companies (live soup list, complements the
    // recently-viewed feed which only has companies the user has
    // opened). Sort timestamp prefers viewed_at; falls back to
    // updated_at for unviewed companies — same shape as channels.
    const crmCompanyData = crmCompaniesAccessor();
    for (const company of crmCompanyData) {
      if (hidden.has(company.id)) continue;

      const viewedAt =
        viewedAtMap.get(company.id) ?? company.viewedAt ?? undefined;

      const version = getCrmCompanyVersion(
        company,
        viewedAt as string | undefined
      );
      const cached = itemCache.get(company.id);

      if (!cached || cached.version !== version) {
        const entity: CrmCompanyEntity = {
          ...company,
          viewedAt: (viewedAt ?? company.viewedAt) as DateValue | null,
        };
        const viewedAtMs = toTimestamp(viewedAt);
        const updatedAtMs = toTimestamp(company.updatedAt);
        const sortTimestamp = viewedAtMs || updatedAtMs;

        const quickAccessItem: QuickAccessItem = {
          kind: 'entity',
          id: company.id,
          bucket: 'crm_company',
          searchText: getCrmCompanySearchText(entity),
          sortTimestamp,
          timestamps: {
            viewedAt,
            updatedAt: company.updatedAt,
            createdAt: company.createdAt,
          },
          data: entity,
        };

        itemCache.set(company.id, { item: quickAccessItem, version });
        allEntries.push({
          id: company.id,
          bucket: 'crm_company',
          sortTimestamp,
        });
      } else {
        allEntries.push({
          id: company.id,
          bucket: cached.item.bucket,
          sortTimestamp: cached.item.sortTimestamp,
        });
      }
    }

    return sortIndexEntries(allEntries);
  });

  const snippetEntries = createLazyMemo(() => {
    const viewedAtMap = soupViewedAtMap();
    const seenIds = new Set(historyEntries().ids);
    const allEntries: IndexEntry[] = [];
    const hidden = hiddenIds();

    // Process snippets (live soup list, complements the history feed
    // which only has snippets the user has opened). Widens the pool to
    // team-shared snippets so the `;` menu lists snippets the user has
    // never opened. History-fed entries win for snippets the user has
    // already opened.
    const snippetData = snippetsAccessor();
    for (const snippet of snippetData) {
      if (hidden.has(snippet.id)) continue;
      if (seenIds.has(snippet.id)) continue;
      seenIds.add(snippet.id);

      const viewedAt =
        viewedAtMap.get(snippet.id) ?? snippet.viewedAt ?? undefined;

      const version = getSnippetVersion(
        snippet,
        viewedAt as string | undefined
      );
      const cached = itemCache.get(snippet.id);

      if (!cached || cached.version !== version) {
        const entity: SnippetEntity = {
          ...snippet,
          viewedAt: (viewedAt ?? snippet.viewedAt) as DateValue | null,
        };
        const viewedAtMs = toTimestamp(viewedAt);
        const updatedAtMs = toTimestamp(snippet.updatedAt);
        const sortTimestamp = viewedAtMs || updatedAtMs;

        const quickAccessItem: QuickAccessItem = {
          kind: 'entity',
          id: snippet.id,
          bucket: 'snippet',
          searchText: getEntitySearchText(entity),
          sortTimestamp,
          timestamps: {
            viewedAt,
            updatedAt: snippet.updatedAt,
            createdAt: snippet.createdAt,
          },
          data: entity,
        };

        itemCache.set(snippet.id, { item: quickAccessItem, version });
        allEntries.push({
          id: snippet.id,
          bucket: 'snippet',
          sortTimestamp,
        });
      } else {
        allEntries.push({
          id: snippet.id,
          bucket: cached.item.bucket,
          sortTimestamp: cached.item.sortTimestamp,
        });
      }
    }

    return sortIndexEntries(allEntries);
  });

  const skillEntries = createLazyMemo(() => {
    const viewedAtMap = soupViewedAtMap();
    const seenIds = new Set(historyEntries().ids);
    const allEntries: IndexEntry[] = [];
    const hidden = hiddenIds();

    // Process skills (live soup list, complements the history feed which
    // only has skills the user has opened). Widens the pool to shared
    // skills so the `/` menu lists skills the user has never opened.
    // History-fed entries win for skills the user has already opened.
    const skillData = skillsAccessor();
    for (const skill of skillData) {
      if (hidden.has(skill.id)) continue;
      if (seenIds.has(skill.id)) continue;
      seenIds.add(skill.id);

      const viewedAt = viewedAtMap.get(skill.id) ?? skill.viewedAt ?? undefined;

      const version = getSkillVersion(skill, viewedAt as string | undefined);
      const cached = itemCache.get(skill.id);

      if (!cached || cached.version !== version) {
        const entity: SkillEntity = {
          ...skill,
          viewedAt: (viewedAt ?? skill.viewedAt) as DateValue | null,
        };
        const viewedAtMs = toTimestamp(viewedAt);
        const updatedAtMs = toTimestamp(skill.updatedAt);
        const sortTimestamp = viewedAtMs || updatedAtMs;

        const quickAccessItem: QuickAccessItem = {
          kind: 'entity',
          id: skill.id,
          bucket: 'skill',
          searchText: getEntitySearchText(entity),
          sortTimestamp,
          timestamps: {
            viewedAt,
            updatedAt: skill.updatedAt,
            createdAt: skill.createdAt,
          },
          data: entity,
        };

        itemCache.set(skill.id, { item: quickAccessItem, version });
        allEntries.push({
          id: skill.id,
          bucket: 'skill',
          sortTimestamp,
        });
      } else {
        allEntries.push({
          id: skill.id,
          bucket: cached.item.bucket,
          sortTimestamp: cached.item.sortTimestamp,
        });
      }
    }

    return sortIndexEntries(allEntries);
  });

  const processedData = createLazyMemo(() => {
    const allEntries = mergeMultipleSortedIndices([
      historyEntries().entries,
      channelEntries(),
      contactEntries(),
      crmCompanyEntries(),
      snippetEntries(),
      skillEntries(),
    ]);
    const seenIds = new Set(allEntries.map((entry) => entry.id));

    // Clean up stale cache entries (items that no longer exist)
    for (const id of itemCache.keys()) {
      if (!seenIds.has(id)) {
        itemCache.delete(id);
      }
    }

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
        indices.get('snippet') ?? [],
        indices.get('skill') ?? [],
        indices.get('chat') ?? [],
        indices.get('project') ?? [],
      ]),
    };
  });

  // helper to get a pre-baked index list if the bucket combination matches
  const getPreBakedIndices = (buckets: Bucket[]): IndexEntry[] | undefined => {
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
  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    const first = args[0];
    const options = typeof first === 'object' ? first : undefined;
    const buckets = options ? [...options.buckets] : (args as Bucket[]);
    const baseList = createLazyMemo(() => {
      if (options?.enabled?.() === false) return [];
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

    const [projectedItems, setProjectedItems] = createSignal<
      | {
          recordKeys: string[];
          materialized: Map<string, QuickAccessItem>;
        }
      | undefined
    >(undefined);
    if (options && cacheHost) {
      let generation = 0;
      onCleanup(() => {
        generation += 1;
      });
      createEffect(() => {
        cacheRevision();
        const enabled = options.enabled?.() !== false;
        const query = options.searchTerm?.() ?? '';
        const currentGeneration = ++generation;
        if (!enabled) {
          setProjectedItems(undefined);
          return;
        }
        void (async () => {
          try {
            const page = await cacheHost.search({
              profile: 'quick-access-v1',
              buckets,
              query,
              limit: query.trim() ? 500 : 50,
            });
            const missingDocuments = page.documents.filter(({ recordKey }) => {
              const separator = recordKey.indexOf(':');
              const id =
                separator < 0 ? recordKey : recordKey.slice(separator + 1);
              return !itemCache.has(id);
            });
            const [historyItems, cachedChannelItems] = await Promise.all([
              materializeCachedGraphqlHistoryItems(cacheHost, missingDocuments),
              materializeCachedGraphqlChannels(cacheHost, missingDocuments),
            ]);
            if (currentGeneration !== generation) return;
            const materializedHistoryItems = new Map(
              historyItems.map((item) => [item.id, item] as const)
            );
            const materializedChannelItems = new Map(
              cachedChannelItems.map((item) => [item.id, item] as const)
            );
            const recordKeys: string[] = [];
            const materialized = new Map<string, QuickAccessItem>();
            const seen = new Set<string>();
            for (const document of page.documents) {
              const separator = document.recordKey.indexOf(':');
              const id =
                separator < 0
                  ? document.recordKey
                  : document.recordKey.slice(separator + 1);
              if (seen.has(id)) continue;
              if (itemCache.get(id)?.item) {
                seen.add(id);
                recordKeys.push(document.recordKey);
                continue;
              }
              const historyItem = materializedHistoryItems.get(id);
              const cachedChannel = materializedChannelItems.get(id);
              let item: QuickAccessItem | undefined;
              if (historyItem) {
                const entity = historyItemToEntity(historyItem);
                item = {
                  kind: 'entity',
                  id,
                  bucket: getBucketForHistoryItem(historyItem),
                  searchText: getEntitySearchText(entity),
                  sortTimestamp: document.timestampMs,
                  timestamps: {
                    updatedAt: historyItem.updatedAt,
                    createdAt: historyItem.createdAt,
                  },
                  data: entity,
                };
              } else if (cachedChannel) {
                item = channelToQuickAccessItem(
                  cachedChannel,
                  document.timestampMs
                );
              }
              if (!item) continue;
              seen.add(id);
              recordKeys.push(document.recordKey);
              materialized.set(id, item);
            }
            setProjectedItems({ recordKeys, materialized });
          } catch {
            if (currentGeneration === generation) {
              setProjectedItems({ recordKeys: [], materialized: new Map() });
            }
          }
        })();
      });
    }

    const list = createLazyMemo(() => {
      const base = baseList();
      if (!options) return base;
      const local = searchQuickAccessItems(base, options.searchTerm?.() ?? '');
      const projected = projectedItems();
      if (!projected) return local;

      // Search describes cached contents, not corpus completeness. Preserve
      // projection rank, then append server/local candidates as fallback.
      const ranked = projected.recordKeys.flatMap((recordKey) => {
        const separator = recordKey.indexOf(':');
        const key = separator < 0 ? recordKey : recordKey.slice(separator + 1);
        const item =
          itemCache.get(key)?.item ?? projected.materialized.get(key);
        return item ? [item] : [];
      });
      const seen = new Set(ranked.map((item) => item.id));
      return ranked.concat(local.filter((item) => !seen.has(item.id)));
    });
    return {
      items: list,
      totalCount: () => list().length,
      hasMore: () => false,
      isLoading: () => false,
      isLoadingMore: () => false,
      loadMore: async () => undefined,
    };
  }) as QuickAccessContextValue['useList'];

  // CRM companies are additive — they fold into the list when their query
  // resolves rather than gating quick access on a slower/failing CRM fetch.
  const isLoading = () =>
    historyQuery.isLoading ||
    (cacheHost ? cachedChannelsQuery.isLoading : channelsLoading());

  const refresh = () => {
    if (cacheHost) {
      setCacheRevision((revision) => revision + 1);
      void cachedChannelsQuery.refetch();
    }
    historyQuery.refetch();
    crmCompaniesQuery.refetch();
    snippetsQuery.refetch();
    skillsQuery.refetch();
  };

  return {
    useList,
    usesRecordSelection: () => false,
    usesSearchProjection: () => cacheHost !== undefined,
    isLoading,
    refresh,
    getById,
  };
}
