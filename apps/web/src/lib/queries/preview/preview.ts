import {
  type EntityAppearance,
  sameAppearance,
} from '@app/features/entity-appearance/core/appearance';
import { crmSnapshotAuthorization } from '@app/lib/urql-solid/authorization';
import { LOCAL_ONLY } from '@core/constant/featureFlags';
import { ThrownResultError } from '@core/util/result';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { cachedUserId } from '@queries/auth/cached-user-id';
import { queryReadyGate } from '@queries/gate';
import { DEFAULT_ITEM_TYPE, type ItemType } from '@service-storage/client';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { queryOptions, useQuery } from '@tanstack/solid-query';
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
  type PreviewDocumentProperties,
  type PreviewItem,
} from './types';

// DEBUG VARS
const SIMULATE_BACKEND_DELAY_MS = 0;
const SIMULATE_FAILURE = false;

const PREVIEW_STALE_TIME = 60 * 1000 * 60 * 24; // 24 hours

/** Calendar events rename and reschedule far more often than documents, and
 * their preview carries the title and datetime chips render — so they go
 * stale on the mention-preview cadence rather than the 24h default. */
const CALENDAR_EVENT_PREVIEW_STALE_TIME = 60 * 1000;

// Callers may pass component props; the cached queryFn keeps only a plain copy.
function itemRequest(entity: ItemEntity): ItemEntity {
  return entity.type === 'channel'
    ? { id: entity.id, type: 'channel', messageId: entity.messageId }
    : { id: entity.id, type: entity.type };
}

function itemPreviewQueryOptions(
  entity: ItemEntity,
  enabled = true,
  staleTime = PREVIEW_STALE_TIME
) {
  const item = itemRequest(entity);
  if (item.type === 'agent_session') staleTime = Math.min(staleTime, 30_000);
  if (item.type === 'calendar_event') {
    staleTime = Math.min(staleTime, CALENDAR_EVENT_PREVIEW_STALE_TIME);
  }
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

function previewDenied(item: ItemEntity): boolean {
  return (
    crmSnapshotAuthorization().paused ||
    (!crmAccessAllowed() &&
      (item.type === 'crm_company' || item.type === 'crm_contact'))
  );
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
  if (previewDenied(item)) return noAccessPreview(item);
  const epoch = crmSnapshotAuthorization().epoch;
  const stale = () =>
    !cacheSessionGeneration.isCurrent(epoch) || previewDenied(item);
  if (isGraphqlPreviewItem(item)) {
    try {
      const preview = await getGraphqlItemPreview(item, options);
      if (stale()) return noAccessPreview(item);
      if (preview) return defaultNameTransform(preview);
    } catch {
      // Preserve the existing access/deletion result through the REST fallback.
    }
    const fallback = await fetchRestPreviewBatch([item]);
    if (stale()) return noAccessPreview(item);
    // A failed request throws, as the dataloader's read below does.
    const errors = fallback.failed.get(item.id);
    if (errors) throw new ThrownResultError(errors);
    return defaultNameTransform(
      fallback.previews.get(item.id) ?? noAccessPreview(item)
    );
  }

  const preview = await queryClient.fetchQuery(itemPreviewQueryOptions(item));
  if (stale()) return noAccessPreview(item);
  return defaultNameTransform(preview);
}

function useItemPreviewQuery(
  item: Accessor<ItemEntity>,
  restStaleTime = PREVIEW_STALE_TIME,
  includeProperties = true
) {
  const enabled = () => !previewDenied(item());
  const graphqlQuery = createGraphqlItemPreviewQuery(
    item,
    includeProperties,
    enabled
  );
  const usesGraphql = createMemo(
    () => isGraphqlPreviewItem(item()) && !graphqlQuery.shouldFallback()
  );

  // Previews render in every message row and building an observer costs more
  // than the GraphQL read itself, so the REST one exists only while it serves.
  const restQuery = createMemo(() =>
    usesGraphql()
      ? undefined
      : useQuery(() =>
          itemPreviewQueryOptions(item(), enabled(), restStaleTime)
        )
  );

  return {
    data: () => {
      if (previewDenied(item())) return noAccessPreview(item());
      if (usesGraphql()) return graphqlQuery.data();
      const rest = restQuery();
      return rest && queryReadyGate(rest) ? rest.data : undefined;
    },
    isLoading: () =>
      usesGraphql()
        ? graphqlQuery.isLoading()
        : (restQuery()?.isPending ?? true),
    isSuccess: () =>
      usesGraphql()
        ? graphqlQuery.data() !== undefined
        : (restQuery()?.isSuccess ?? false),
    usesGraphql,
    refetch: async () => {
      if (!enabled()) return;
      if (usesGraphql()) await graphqlQuery.refetch();
      else await restQuery()?.refetch();
    },
  };
}

// Cached callbacks must only close over plain request values, never hook state.
function channelMessagePreviewQueryOptions(
  itemId: string,
  channelId: string,
  messageId: string,
  enabled: boolean
) {
  return queryOptions({
    queryKey: previewKeys.item(itemId)._ctx.channelMessage(channelId, messageId)
      .queryKey,
    queryFn: ({ signal }) => fetchMessageContext(channelId, messageId, signal),
    staleTime: PREVIEW_STALE_TIME,
    enabled,
  });
}

export function useItemPreview(item: Accessor<ItemEntity>) {
  const previewQuery = useItemPreviewQuery(item);

  // Only a REST preview of a message link loads its message separately.
  const loadsMessageContext = createMemo(() => {
    const item_ = item();
    return (
      item_.type === 'channel' &&
      !!item_.messageId &&
      !previewQuery.usesGraphql()
    );
  });
  const maybeMessageQuery = createMemo(() =>
    loadsMessageContext()
      ? useQuery(() => {
          const item_ = item();
          const channelId = item_.type === 'channel' ? item_.id : '';
          const messageId =
            item_.type === 'channel' ? (item_.messageId ?? '') : '';
          return channelMessagePreviewQueryOptions(
            item_.id,
            channelId,
            messageId,
            !!channelId && !!messageId && previewQuery.isSuccess()
          );
        })
      : undefined
  );

  const preview = createMemo(() => {
    const data = previewQuery.data();
    // Disabled message queries are pending but not loading. Reading their
    // data still suspends briefly whenever a preview row mounts.
    const messageQuery = maybeMessageQuery();
    const channelMessageData =
      messageQuery && !messageQuery.isPending && queryReadyGate(messageQuery)
        ? messageQuery.data
        : undefined;

    if (!data) {
      return {
        loading: true,
        id: item().id,
        type: item().type ?? DEFAULT_ITEM_TYPE,
      } as PreviewItem;
    }
    const dataWithName = defaultNameTransform(data);
    if (channelMessageData && isAccessiblePreviewItem(dataWithName)) {
      return {
        ...dataWithName,
        messageContext: channelMessageData,
      };
    }
    return dataWithName;
  });

  // Presence selects the GraphQL-owned metadata path even when a lightweight
  // cached title arrives before properties. Pending edges must never mount a
  // fallback child query, or the waterfall returns on a warm cache.
  const documentProperties = (): PreviewDocumentProperties | undefined => {
    if (
      !previewQuery.usesGraphql() ||
      (item().type ?? DEFAULT_ITEM_TYPE) !== 'document'
    )
      return undefined;
    const current = preview();
    const metadata =
      isAccessiblePreviewItem(current) && current.type === 'document'
        ? current.documentMetadata
        : undefined;
    return {
      properties: metadata?.properties,
      canEdit: metadata?.canEdit ?? false,
      refetch: previewQuery.refetch,
    };
  };
  return [preview, { documentProperties }] as const;
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
  const identity = useItemIdentity(item);
  return () => identity()?.rawName;
}

/** Reads lightweight identity fields without fetching document properties. */
export function useItemIdentity(
  item: Accessor<ItemEntity>
): Accessor<AccessiblePreviewItem | undefined> {
  const query = useItemPreviewQuery(item, RAW_NAME_STALE_TIME, false);
  return () => {
    const data = query.data();
    return data && isAccessiblePreviewItem(data) ? data : undefined;
  };
}

/** Revalidates active previews without crossing their selected transport. */
export function invalidatePreview(itemId?: string) {
  const graphqlRefresh = refreshActiveGraphqlPreviewQueries(itemId);
  const restRefresh = queryClient.invalidateQueries({
    queryKey: itemId ? previewKeys.item(itemId).queryKey : previewKeys._def,
    // Only REST exceptions and fallbacks have an active TanStack observer.
    // Disabled fallback queries must stay untouched.
    predicate: (query) => query.isActive(),
  });
  return Promise.all([graphqlRefresh, restRefresh]);
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

/** Writes a REST preview cache entry. */
function setPreviewData(itemId: string, updater: Setter<PreviewItem>) {
  return queryClient.setQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey,
    updater
  );
}

export function setPreviewFileType(itemId: string, fileType: string) {
  const userId = cachedUserId();
  if (!userId) return;
  return runGraphqlPreviewWrite(
    setGraphqlPreviewFileType(itemId, fileType, userId)
  );
}

/** Patch a loaded REST preview without creating an inaccessible preview. */
export function setPreviewAppearance(
  itemId: string,
  appearance: EntityAppearance | null | undefined,
  expected?: EntityAppearance
): { appearance: EntityAppearance | null | undefined } | undefined {
  const previous = getPreviewData(itemId);
  if (!previous || !isAccessiblePreviewItem(previous)) return;
  if (expected && !sameAppearance(previous.appearance, expected)) return;
  setPreviewData(itemId, (item) => ({ ...item, appearance }));
  return { appearance: previous.appearance };
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
  if (isGraphqlPreviewItem(item)) {
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
  generation,
  itemId,
  itemType,
  name,
  fileType,
  subType,
}: {
  generation: string;
  itemId: string;
  itemType: Exclude<ItemType, 'calendar_event'>;
  name?: string;
  fileType?: string;
  subType?: { type: 'task' | 'snippet' | 'skill'; is_completed?: boolean };
}) {
  if (!cacheSessionGeneration.isCurrent(generation)) return;
  if (
    itemType === 'document' ||
    itemType === 'chat' ||
    itemType === 'project'
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
          userId,
          generation
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
