import { LOCAL_ONLY } from '@core/constant/featureFlags';
import { queryReadyGate } from '@queries/gate';
import { DEFAULT_ITEM_TYPE, type ItemType } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor, Setter } from 'solid-js';
import { createMemo } from 'solid-js';
import { queryClient } from '../client';
import { previewDataLoader } from './dataloader';
import { defaultNameTransform, fetchMessageContext } from './fetchers';
import { previewKeys } from './keys';
import type { AccessiblePreviewItem, ItemEntity, PreviewItem } from './types';

// DEBUG VARS
const SIMULATE_BACKEND_DELAY_MS = 0;
const SIMULATE_FAILURE = false;

const PREVIEW_STALE_TIME = 60 * 1000 * 60 * 24; // 24 hours

function itemPreviewQueryOptions(item: ItemEntity) {
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
    staleTime: PREVIEW_STALE_TIME,
  };
}

export async function getItemPreview(item: ItemEntity): Promise<PreviewItem> {
  const preview = await queryClient.fetchQuery(itemPreviewQueryOptions(item));
  return defaultNameTransform(preview);
}

export function useItemPreview(item: Accessor<ItemEntity>) {
  const previewQuery = useQuery(() => itemPreviewQueryOptions(item()));

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
      enabled: !!channelId && !!messageId && previewQuery.isSuccess,
    };
  });

  const preview = createMemo(() => {
    const data = queryReadyGate(previewQuery) ? previewQuery.data : undefined;
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

/** Invalidate preview for the given item id. if no id is provided, invalidates all previews */
export function invalidatePreview(itemId?: string) {
  if (!itemId)
    return queryClient.invalidateQueries({
      queryKey: previewKeys._def,
    });
  return queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
  });
}

function getPreviewData(itemId: string): PreviewItem | undefined {
  return queryClient.getQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey
  );
}

export function getCachedItemPreview(itemId: string): PreviewItem | undefined {
  return getPreviewData(itemId);
}

/** Directly update preview data in the cache without refetching */
function setPreviewData(itemId: string, updater: Setter<PreviewItem>) {
  return queryClient.setQueryData<PreviewItem>(
    previewKeys.item(itemId).queryKey,
    updater
  );
}

export function setPreviewFileType(itemId: string, fileType: string) {
  const prev = getPreviewData(itemId);
  if (prev) return setPreviewData(itemId, (prev) => ({ ...prev, fileType }));
}

/** Sets the preview name in the cache. If the item is not in the cache,
 * we will optimistically update the name and prefetch the item. */
export function setPreviewName({
  itemId,
  name,
  itemType,
}: {
  itemId: string;
  name: string;
  itemType?: ItemType;
}) {
  const prev = getPreviewData(itemId);
  if (prev)
    return setPreviewData(itemId, (prev) => ({
      ...prev,
      rawName: name,
      name,
    }));

  if (!itemType) {
    console.warn('no preview item type provided for cache miss, using default');
  }

  let defaultPreviewItem: AccessiblePreviewItem = {
    id: itemId,
    rawName: name,
    name,
    loading: false,
    access: 'access',
    type: itemType ?? DEFAULT_ITEM_TYPE,
  };

  // if the item isn't in the cache, we can optimistically create a new item
  const res = setPreviewData(itemId, (_prev) => defaultPreviewItem);

  // invalidate the item so that we can refetch on next render
  // note that we cannot directly call the fetch here because the item name is not necessarily updated on the backend
  queryClient.invalidateQueries({
    queryKey: previewKeys.item(itemId).queryKey,
  });

  return res;
}

/**
 * Optimistically populate preview cache for a newly created item.
 * This prevents race conditions where a fetch might return 'does_not_exist'
 * before the backend has fully propagated the new item.
 *
 * Call this immediately after creating an item to ensure the preview cache
 * has valid data before any components try to fetch it.
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
  itemType: ItemType;
  name?: string;
  fileType?: string;
  subType?: { type: 'task' | 'snippet'; is_completed?: boolean };
}) {
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

  // Optimistically set the preview data
  setPreviewData(itemId, (_prev) => defaultPreviewItem);

  // Schedule a background refetch to get the real data from the server
  // Use a small delay to give the backend time to propagate
  setTimeout(() => {
    queryClient.invalidateQueries({
      queryKey: previewKeys.item(itemId).queryKey,
    });
  }, 100);
}
