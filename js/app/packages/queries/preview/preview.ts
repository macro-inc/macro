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

const PREVIEW_STALE_TIME = 60 * 1000 * 60 * 24; // 24 hours

/**
 * DEBUG: Set to a number between 0-1 to force that percentage of preview fetches to fail.
 * Example: 0.3 = 30% of previews will fail
 * Set to 0 or undefined to disable forced failures.
 *
 * You can modify this at runtime in the browser console:
 * window.DEBUG_PREVIEW_FAILURE_RATE = 0.3
 */
export let DEBUG_PREVIEW_FAILURE_RATE = 1; // Set to 0.3 for 30% failure rate

/**
 * DEBUG: Enable console logging for preview state transitions.
 * Set to false in production to reduce console noise.
 *
 * You can modify this at runtime in the browser console:
 * window.DEBUG_ENABLE_PREVIEW_LOGGING = true
 */
export let DEBUG_ENABLE_PREVIEW_LOGGING = true; // Set to false to disable logging

// Make it accessible via window for runtime debugging
if (typeof window !== 'undefined') {
  (window as any).DEBUG_PREVIEW_FAILURE_RATE = DEBUG_PREVIEW_FAILURE_RATE;
  (window as any).DEBUG_ENABLE_PREVIEW_LOGGING = DEBUG_ENABLE_PREVIEW_LOGGING;

  Object.defineProperty(window, 'setPreviewFailureRate', {
    value: (rate: number) => {
      DEBUG_PREVIEW_FAILURE_RATE = rate;
      (window as any).DEBUG_PREVIEW_FAILURE_RATE = rate;
      console.log(`Preview failure rate set to ${rate * 100}%`);
    },
    writable: false,
    configurable: true,
  });

  Object.defineProperty(window, 'setPreviewLogging', {
    value: (enabled: boolean) => {
      DEBUG_ENABLE_PREVIEW_LOGGING = enabled;
      (window as any).DEBUG_ENABLE_PREVIEW_LOGGING = enabled;
      console.log(`Preview logging ${enabled ? 'enabled' : 'disabled'}`);
    },
    writable: false,
    configurable: true,
  });
}

function itemPreviewQueryOptions(item: ItemEntity) {
  return {
    queryKey: previewKeys.item(item.id).queryKey,
    queryFn: async () => {
      // DEBUG: Force random failures for testing
      if (
        DEBUG_PREVIEW_FAILURE_RATE > 0 &&
        Math.random() < DEBUG_PREVIEW_FAILURE_RATE
      ) {
        if (DEBUG_ENABLE_PREVIEW_LOGGING) {
          console.warn(`[DEBUG] Forcing preview failure for item ${item.id}`);
        }
        throw new Error('DEBUG: Forced preview failure');
      }
      return previewDataLoader.load(item);
    },
    staleTime: PREVIEW_STALE_TIME,
    retry: 3, // Retry failed queries up to 3 times
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff: 1s, 2s, 4s, max 10s
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
    const messageId = item_.type === 'channel' ? item_.messageId : undefined;
    return {
      queryKey: previewKeys.item(item().id)._ctx.channelMessage(messageId!)
        .queryKey,
      queryFn: () => fetchMessageContext(messageId!),
      staleTime: PREVIEW_STALE_TIME,
      enabled: !!messageId && previewQuery.isSuccess,
    };
  });

  const preview = createMemo(() => {
    const data = queryReadyGate(previewQuery) ? previewQuery.data : undefined;
    const channelMessageData = queryReadyGate(maybeChannelMessageQuery)
      ? maybeChannelMessageQuery.data
      : undefined;

    if (!data) {
      // Check if query failed after all retries
      if (previewQuery.isError) {
        if (DEBUG_ENABLE_PREVIEW_LOGGING) {
          console.warn(
            `[Preview] Query failed for item ${item().id} after all retries. Returning does_not_exist state.`,
            {
              error: previewQuery.error,
              failureCount: previewQuery.failureCount,
              isPaused: previewQuery.isPaused,
            }
          );
        }
        return {
          loading: false,
          access: 'does_not_exist',
          id: item().id,
          type: item().type ?? DEFAULT_ITEM_TYPE,
        } as PreviewItem;
      }
      // Still loading or retrying
      if (DEBUG_ENABLE_PREVIEW_LOGGING) {
        console.log(`[Preview] Loading state for item ${item().id}`, {
          isLoading: previewQuery.isLoading,
          isFetching: previewQuery.isFetching,
          fetchStatus: previewQuery.fetchStatus,
        });
      }
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
