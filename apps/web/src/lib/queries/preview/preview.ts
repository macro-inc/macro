import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
  LOCAL_ONLY,
} from '@core/constant/featureFlags';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryReadyGate } from '@queries/gate';
import { DEFAULT_ITEM_TYPE, type ItemType } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor, Setter } from 'solid-js';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { refreshActiveGraphqlPreviewQueries } from './active-queries';
import { previewDataLoader } from './dataloader';
import {
  defaultNameTransform,
  fetchMessageContext,
  fetchRestPreviewBatch,
} from './fetchers';
import {
  canWriteGraphqlPreviewCache,
  createGraphqlItemPreviewQuery,
  getGraphqlItemPreview,
  isGraphqlPreviewItem,
  setGraphqlPreviewFileType,
  setGraphqlPreviewName,
  setGraphqlPreviewOnCreate,
} from './graphql';
import { previewKeys } from './keys';
import {
  type AccessiblePreviewItem,
  type ItemEntity,
  isAccessiblePreviewItem,
  type PreviewItem,
} from './types';

// DEBUG VARS
const SIMULATE_BACKEND_DELAY_MS = 0;
const SIMULATE_FAILURE = false;

const PREVIEW_STALE_TIME = 60 * 1000 * 60 * 24; // 24 hours

function itemPreviewQueryOptions(
  item: ItemEntity,
  enabled = true,
  staleTime = PREVIEW_STALE_TIME
) {
  return {
    queryKey: previewKeys.item(item.id).queryKey,
    queryFn: async () => {
      if (LOCAL_ONLY) {
        // Simulate backend propagation delay for testing race conditions
        if (SIMULATE_BACKEND_DELAY_MS > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, SIMULATE_BACKEND_DELAY_MS)
          );
        }

        if (SIMULATE_FAILURE) {
          return Promise.resolve({
            id: item.id,
            type: item.type ?? DEFAULT_ITEM_TYPE,
            access: 'does_not_exist',
            loading: false,
          } as PreviewItem);
        }
      }

      return previewDataLoader.load(item);
    },
    staleTime,
    enabled,
  };
}

function noAccessPreview(item: ItemEntity): PreviewItem {
  return {
    id: item.id,
    type: item.type ?? DEFAULT_ITEM_TYPE,
    access: 'no_access',
    loading: false,
  };
}

export async function getItemPreview(
  item: ItemEntity,
  options?: { requireFresh?: boolean }
): Promise<PreviewItem> {
  if (isFeatureEnabled(enableGraphqlSoup) && isGraphqlPreviewItem(item)) {
    try {
      const preview = await getGraphqlItemPreview(item, options);
      if (preview) return defaultNameTransform(preview);
    } catch {
      // Preserve the existing access/deletion result through the REST fallback.
    }
    const fallback = await fetchRestPreviewBatch([item]);
    return defaultNameTransform(fallback.get(item.id) ?? noAccessPreview(item));
  }

  const preview = await queryClient.fetchQuery(itemPreviewQueryOptions(item));
  return defaultNameTransform(preview);
}

function useItemPreviewQuery(
  item: Accessor<ItemEntity>,
  restStaleTime = PREVIEW_STALE_TIME
) {
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);
  const graphqlRequested = () => graphqlSoupFlag().enabled;
  const graphqlQuery = createGraphqlItemPreviewQuery(item, graphqlRequested);
  const usesGraphql = () =>
    graphqlRequested() &&
    isGraphqlPreviewItem(item()) &&
    !graphqlQuery.shouldFallback();

  const restQuery = useQuery(() =>
    itemPreviewQueryOptions(item(), !usesGraphql(), restStaleTime)
  );

  return {
    data: () =>
      usesGraphql()
        ? graphqlQuery.data()
        : queryReadyGate(restQuery)
          ? restQuery.data
          : undefined,
    isLoading: () =>
      usesGraphql() ? graphqlQuery.isLoading() : restQuery.isPending,
    isSuccess: () =>
      usesGraphql() ? graphqlQuery.data() !== undefined : restQuery.isSuccess,
    usesGraphql,
  };
}

export function useItemPreview(item: Accessor<ItemEntity>) {
  const previewQuery = useItemPreviewQuery(item);

  const maybeChannelMessageQuery = useQuery(() => {
    const item_ = item();
    const channelId = item_.type === 'channel' ? item_.id : '';
    const messageId = item_.type === 'channel' ? (item_.messageId ?? '') : '';
    return {
      queryKey: previewKeys
        .item(item_.id)
        ._ctx.channelMessage(channelId, messageId).queryKey,
      queryFn: ({ signal }) =>
        fetchMessageContext(channelId, messageId, signal),
      staleTime: PREVIEW_STALE_TIME,
      enabled:
        !previewQuery.usesGraphql() &&
        !!channelId &&
        !!messageId &&
        previewQuery.isSuccess(),
    };
  });

  const preview = createMemo(() => {
    const data = previewQuery.data();
    const channelMessageData = queryReadyGate(maybeChannelMessageQuery)
      ? maybeChannelMessageQuery.data
      : undefined;

    if (!data) {
      return {
        loading: true,
        id: item().id,
        type: item().type ?? DEFAULT_ITEM_TYPE,
      } as PreviewItem;
    }
    const dataWithName = defaultNameTransform(data);
    if (channelMessageData) {
      return {
        ...dataWithName,
        messageContext: channelMessageData,
      };
    }
    return dataWithName;
  });

  return [preview] as const;
}

/** Stale time for live display names (e.g. open-document titles), which
 * should pick up external renames on remount rather than waiting out the
 * 24h preview default. */
const RAW_NAME_STALE_TIME = 5 * 60 * 1000;

/**
 * Subscribe to an item's raw (untransformed) display name.
 * Returns undefined while loading or when the item is inaccessible, so
 * callers can fall through to their own defaults. Optimistic rename and
 * file-type mutations write to this cache via `setPreviewName` /
 * `setPreviewFileType`.
 */
export function useItemRawName(
  item: Accessor<{ id: string; type?: ItemType }>
): Accessor<string | undefined> {
  const query = useItemPreviewQuery(item, RAW_NAME_STALE_TIME);

  return () => {
    const data = query.data();
    if (!data || !isAccessiblePreviewItem(data)) return undefined;
    return data.rawName;
  };
}

/** Revalidates active previews without crossing their selected transport. */
export function invalidatePreview(itemId?: string) {
  if (!isFeatureEnabled(enableGraphqlSoup)) {
    if (!itemId)
      return queryClient.invalidateQueries({
        queryKey: previewKeys._def,
      });
    return queryClient.invalidateQueries({
      queryKey: previewKeys.item(itemId).queryKey,
    });
  }

  const graphqlRefresh = refreshActiveGraphqlPreviewQueries(itemId);
  const restRefresh = queryClient.invalidateQueries({
    queryKey: itemId ? previewKeys.item(itemId).queryKey : previewKeys._def,
    // Under the GraphQL flag, only REST exceptions and fallbacks have an
    // active TanStack observer. Disabled fallback queries must stay untouched.
    predicate: (query) => query.isActive(),
  });
  return Promise.all([graphqlRefresh, restRefresh]);
}

function cachedUserId(): string | undefined {
  return queryClient.getQueryData<UserInfoData>(authKeys.userInfo.queryKey)?.id;
}

function runGraphqlPreviewWrite(write: Promise<void>) {
  void write.catch((error) => {
    console.error('[graphql-preview] failed to update normalized cache', error);
  });
}

function getPreviewData(itemId: string): PreviewItem | undefined {
  return queryClient.getQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey
  );
}

/** Optimistically updates the selected transport's document file type. */
function setPreviewData(itemId: string, updater: Setter<PreviewItem>) {
  return queryClient.setQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey,
    updater
  );
}

export function setPreviewFileType(itemId: string, fileType: string) {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const userId = cachedUserId();
    if (!userId) return;
    return runGraphqlPreviewWrite(
      setGraphqlPreviewFileType(itemId, fileType, userId)
    );
  }
  const prev = getPreviewData(itemId);
  if (prev) return setPreviewData(itemId, (prev) => ({ ...prev, fileType }));
}

/** Optimistically updates a preview name in the selected transport cache. */
export function setPreviewName({
  itemId,
  name,
  itemType,
}: {
  itemId: string;
  name: string;
  // Calendar event previews carry required API-served event data, so the
  // optimistic default constructor cannot fabricate one.
  itemType?: Exclude<ItemType, 'calendar_event'>;
}) {
  const item = { id: itemId, type: itemType } satisfies ItemEntity;
  if (isFeatureEnabled(enableGraphqlSoup) && isGraphqlPreviewItem(item)) {
    const userId = cachedUserId();
    if (!userId) return;
    return runGraphqlPreviewWrite(setGraphqlPreviewName(item, name, userId));
  }
  const prev = getPreviewData(itemId);
  // only merge into accessible entries: a cached no_access/does_not_exist
  // (e.g. a fetch that raced backend propagation of a new item) would
  // otherwise swallow the optimistic name, so fall through and overwrite
  if (prev && isAccessiblePreviewItem(prev))
    return setPreviewData(itemId, (prev) => ({
      ...prev,
      rawName: name,
      name,
    }));

  if (!itemType && !prev) {
    console.warn('no preview item type provided for cache miss, using default');
  }

  let defaultPreviewItem: AccessiblePreviewItem = {
    id: itemId,
    rawName: name,
    name,
    loading: false,
    access: 'access',
    type: (itemType ?? prev?.type ?? DEFAULT_ITEM_TYPE) as Exclude<
      ItemType,
      'calendar_event'
    >,
  };

  // if the item isn't in the cache, we can optimistically create a new item
  const res = setPreviewData(itemId, (_prev) => defaultPreviewItem);

  // mark stale for the next natural refetch (mount/focus) without refetching
  // active observers now: the backend may not have processed the rename yet,
  // so an immediate refetch could clobber the optimistic name with the old one
  queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
    refetchType: 'none',
  });

  return res;
}

/**
 * Optimistically populate the selected transport's preview cache for a new item.
 * GraphQL writes the exact preview projection into the normalized cache; REST
 * seeds its TanStack query. This prevents an immediate fetch from returning
 * `does_not_exist` before the backend has fully propagated the new item.
 *
 * Call this immediately after creating an item to ensure the preview cache
 * has valid data before any components try to fetch it. The seed is stored
 * as fresh data: it carries exactly what was sent to the backend
 * (name/fileType/subType), so there is nothing to refetch, and an immediate
 * revalidation could race propagation and clobber the seed with
 * 'does_not_exist'. Server truth reconciles through normal staleness.
 *
 * @param itemId - The unique identifier of the newly created item
 * @param itemType - The type of item ('document', 'chat', 'project', etc.)
 * @param name - Optional name for the item. Defaults to empty string if not provided
 * @param fileType - Optional file type (e.g., 'md', 'canvas', 'py'). Used for documents
 * @param subType - Optional subType to distinguish special document types.
 *                  **Important**: For tasks, you MUST pass `{ type: 'task', is_completed: false }`
 *                  to properly identify the document as a task rather than a regular markdown file.
 *                  Without this, tasks will appear as generic markdown documents in the UI.
 *
 * @example
 * // Creating a regular markdown document
 * setPreviewOnCreate({
 *   itemId: docId,
 *   itemType: 'document',
 *   name: 'My Document',
 *   fileType: 'md',
 * });
 *
 * @example
 * // Creating a task - note the subType parameter
 * setPreviewOnCreate({
 *   itemId: taskId,
 *   itemType: 'document',
 *   name: 'My Task',
 *   fileType: 'md',
 *   subType: { type: 'task', is_completed: false },
 * });
 */
export function setPreviewOnCreate({
  itemId,
  itemType,
  name,
  fileType,
  subType,
}: {
  itemId: string;
  itemType: Exclude<ItemType, 'calendar_event'>;
  name?: string;
  fileType?: string;
  subType?: { type: 'task' | 'snippet' | 'skill'; is_completed?: boolean };
}) {
  if (
    isFeatureEnabled(enableGraphqlSoup) &&
    (itemType === 'document' || itemType === 'chat' || itemType === 'project')
  ) {
    const userId = cachedUserId();
    if (userId && canWriteGraphqlPreviewCache()) {
      return runGraphqlPreviewWrite(
        setGraphqlPreviewOnCreate(
          {
            itemId,
            itemType,
            name,
            fileType,
            subType,
          },
          userId
        )
      );
    }
  }
  const defaultPreviewItem: AccessiblePreviewItem = {
    id: itemId,
    rawName: name ?? '',
    name: name ?? '',
    loading: false,
    access: 'access',
    type: itemType,
    fileType: fileType as any,
    subType: subType as any,
    updatedAt: new Date().toISOString(),
  };

  setPreviewData(itemId, (_prev) => defaultPreviewItem);
}
