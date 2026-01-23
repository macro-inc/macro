import { DEFAULT_ITEM_TYPE } from '@service-storage/client';
import type { ItemEntity, PreviewItem } from './types';
import { fetchPreviewBatch } from './fetchers';

type BatchRequest = {
  item: ItemEntity;
  resolve: (preview: PreviewItem) => void;
  reject: (error: Error) => void;
};

class PreviewBatcher {
  private queue: BatchRequest[] = [];
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly batchDelay = 50;

  add(item: ItemEntity): Promise<PreviewItem> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.scheduleBatch();
    });
  }

  private scheduleBatch() {
    if (this.timeoutId !== null) {
      return;
    }

    this.timeoutId = setTimeout(() => {
      this.processBatch();
    }, this.batchDelay);
  }

  private async processBatch() {
    if (this.queue.length === 0) {
      this.timeoutId = null;
      return;
    }

    const batch = this.queue.splice(0);
    this.timeoutId = null;

    try {
      const items = batch.map((req) => req.item);
      const results = await fetchPreviewBatch(items);

      for (const request of batch) {
        const preview = results.get(request.item.id);
        if (preview) {
          request.resolve(preview);
        } else {
          request.resolve({
            id: request.item.id,
            type: request.item.type ?? DEFAULT_ITEM_TYPE,
            loading: false,
            access: 'does_not_exist',
          });
        }
      }
    } catch (error) {
      for (const request of batch) {
        request.reject(
          error instanceof Error ? error : new Error('Failed to fetch preview')
        );
      }
    }
  }
}

export const previewBatcher = new PreviewBatcher();
