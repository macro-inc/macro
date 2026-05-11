import type { ItemLike } from '@core/constant/allBlocks';
import { isErr } from '@core/util/maybeResult';
import { storageServiceClient } from '@service-storage/client';
import { AsyncBatcher } from '@tanstack/pacer';
import type { PreviewItem } from './types';

const WAKEUP_TTL_MS = 60 * 1000;
const WAKEUP_DEBOUNCE_MS = 200;
const WAKEUP_MAX_BATCH_SIZE = 100;

export const BULK_DOCUMENT_WAKEUP_FEATURE_FLAG = 'enable-bulk-document-wakeup';

const recentWakeups = new Map<string, number>();

function cleanupRecentWakeups(now: number) {
  for (const [documentId, timestamp] of recentWakeups.entries()) {
    if (now - timestamp >= WAKEUP_TTL_MS) {
      recentWakeups.delete(documentId);
    }
  }
}

const documentWakeupBatcher = new AsyncBatcher<string>(
  async (documentIds) => {
    const uniqueDocumentIds = [...new Set(documentIds)];
    if (uniqueDocumentIds.length === 0) return;

    const result = await storageServiceClient.bulkWakeupSyncServiceDocuments({
      document_ids: uniqueDocumentIds,
    });

    if (isErr(result)) {
      throw new Error('Failed to bulk wakeup sync service documents');
    }
  },
  {
    wait: WAKEUP_DEBOUNCE_MS,
    maxSize: WAKEUP_MAX_BATCH_SIZE,
    asyncRetryerOptions: {
      maxAttempts: 2,
      backoff: 'exponential',
      baseWait: 200,
      jitter: 0.1,
      throwOnError: 'last',
    },
    onError: (error, documentIds) => {
      for (const documentId of documentIds) {
        recentWakeups.delete(documentId);
      }
      console.error('Failed to bulk wakeup sync service documents', error);
    },
    throwOnError: false,
  }
);

function enqueueDocumentIdWakeup(documentId: string) {
  const now = Date.now();
  const lastWakeup = recentWakeups.get(documentId);
  if (lastWakeup && now - lastWakeup < WAKEUP_TTL_MS) {
    return;
  }

  recentWakeups.set(documentId, now);
  cleanupRecentWakeups(now);
  documentWakeupBatcher.addItem(documentId);
}

export type WakeableDocument = ItemLike & {
  id: string;
  type: 'document';
  fileType: 'md';
};

export function isWakeableDocument(
  item: ItemLike & { id: string }
): item is WakeableDocument {
  return item.type === 'document' && item.fileType === 'md';
}

export function enqueueDocumentWakeup(item: WakeableDocument) {
  enqueueDocumentIdWakeup(item.id);
}

export function enqueuePreviewWakeup(item: PreviewItem) {
  if (item.loading || item.access !== 'access') return;
  if (!isWakeableDocument(item)) return;

  enqueueDocumentWakeup(item);
}
