import { AsyncBatcher } from '@tanstack/pacer';
import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import type { ItemEntity, PreviewItem } from './types';
import { fetchPreviewBatch } from './fetchers';

type PendingRequest = {
  item: ItemEntity;
  resolve: (preview: PreviewItem) => void;
  reject: (error: Error) => void;
};

class PreviewDataLoader {
  // map item id to array of pending requests
  private pendingRequests = new Map<string, PendingRequest[]>();

  private batcher = new AsyncBatcher<ItemEntity>(
    async (items) => {
      return await fetchPreviewBatch(items);
    },
    {
      wait: 30,
      maxSize: 50,
      asyncRetryerOptions: {
        maxAttempts: 3,
        backoff: 'exponential',
        baseWait: 200,
        jitter: 0.1,
        throwOnError: 'last',
      },
      onSuccess: (results: Map<string, PreviewItem>, batch) => {
        for (const item of batch) {
          const key = this.getCacheKey(item);
          const requests = this.pendingRequests.get(key);

          if (requests) {
            const preview =
              results.get(item.id) ??
              ({
                id: item.id,
                type: item.type ?? DEFAULT_ITEM_TYPE,
                loading: false,
                access: 'does_not_exist',
              } as PreviewItem);

            for (const request of requests) {
              request.resolve(preview);
            }

            this.pendingRequests.delete(key);
          }
        }
      },
      onError: (error, batch) => {
        for (const item of batch) {
          const key = this.getCacheKey(item);
          const requests = this.pendingRequests.get(key);

          if (requests) {
            const err =
              error instanceof Error
                ? error
                : new Error('Failed to fetch preview');
            for (const request of requests) {
              request.reject(err);
            }
            this.pendingRequests.delete(key);
          }
        }
      },
      throwOnError: false,
    }
  );

  load(item: ItemEntity): Promise<PreviewItem> {
    const key = this.getCacheKey(item);

    return new Promise((resolve, reject) => {
      const existing = this.pendingRequests.get(key);
      if (existing) {
        existing.push({ item, resolve, reject });
      } else {
        this.pendingRequests.set(key, [{ item, resolve, reject }]);
        this.batcher.addItem(item);
      }
    });
  }

  private getCacheKey(item: ItemEntity): string {
    return `${item.id}`;
  }
}

export const previewDataLoader = new PreviewDataLoader();
