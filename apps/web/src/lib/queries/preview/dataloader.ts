import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import { AsyncBatcher } from '@tanstack/pacer';
import { fetchRestPreviewBatch, type PreviewBatch } from './fetchers';
import { previewKeys } from './keys';
import type { ItemEntity, PreviewItem } from './types';

type PendingRequest = {
  item: ItemEntity;
  resolve: (preview: PreviewItem) => void;
  reject: (error: Error) => void;
};

type PreviewBatchEntry = {
  item: ItemEntity;
  generation: string;
  requests: PendingRequest[];
};

class PreviewDataLoader {
  // Each batch owns its waiters, including after a newer generation replaces it.
  private pendingRequests = new Map<string, PreviewBatchEntry>();

  private batcher = new AsyncBatcher<PreviewBatchEntry>(
    async (entries) => {
      return await fetchRestPreviewBatch(entries.map((entry) => entry.item));
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
      onSuccess: (results: PreviewBatch, batch) => {
        for (const entry of batch) {
          const { item, generation, requests } = entry;
          const key = this.getCacheKey(item);
          if (this.pendingRequests.get(key) === entry)
            this.pendingRequests.delete(key);
          if (!cacheSessionGeneration.isCurrent(generation)) {
            for (const request of requests)
              request.reject(new StaleCacheAuthorityError());
          } else {
            // A failed request is no answer: reject, so the query retries
            // and caches nothing, rather than resolving "No Access".
            const errors = results.failed.get(item.id);
            if (errors) {
              const error = new ThrownResultError(errors);
              for (const request of requests) request.reject(error);
              continue;
            }
            // A missing batch entry means no fetcher handled this item, not
            // that it was deleted — only fetchers may report 'does_not_exist'.
            const preview =
              results.previews.get(item.id) ??
              ({
                id: item.id,
                type: item.type ?? DEFAULT_ITEM_TYPE,
                loading: false,
                access: 'no_access',
              } as PreviewItem);

            for (const request of requests) {
              request.resolve(preview);
            }
          }
        }
      },
      onError: (error, batch) => {
        for (const entry of batch) {
          const { item, generation, requests } = entry;
          const key = this.getCacheKey(item);
          if (this.pendingRequests.get(key) === entry)
            this.pendingRequests.delete(key);
          let reason =
            error instanceof Error
              ? error
              : new Error('Failed to fetch preview');
          if (!cacheSessionGeneration.isCurrent(generation))
            reason = new StaleCacheAuthorityError();
          for (const request of requests) {
            request.reject(reason);
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
      if (existing && cacheSessionGeneration.isCurrent(existing.generation)) {
        existing.requests.push({ item, resolve, reject });
      } else {
        const entry = {
          item,
          generation: cacheSessionGeneration.capture(),
          requests: [{ item, resolve, reject }],
        };
        this.pendingRequests.set(key, entry);
        fireAndForget(this.batcher.addItem(entry), 'preview-loader');
      }
    });
  }

  private getCacheKey(item: ItemEntity): string {
    return previewKeys.item(item.id).queryKey.join(':');
  }
}

export const previewDataLoader = new PreviewDataLoader();
