import { AsyncBatcher } from '@tanstack/pacer';
import { storageServiceClient } from '@service-storage/client';
import { isErr } from '@core/util/maybeResult';
import type { PreviewItem } from './types';

const WAKEUP_TTL_MS = 60 * 1000;
const WAKEUP_DEBOUNCE_MS = 200;
const WAKEUP_MAX_BATCH_SIZE = 100;

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

type WakeableEntity = {
  id: string;
  type?: string;
  fileType?: string | null;
  subType?: { type?: string | null } | null;
};

export function enqueueDocumentWakeup(item: WakeableEntity) {
  if (item.type !== 'document') return;
  if (item.fileType !== 'md' && item.subType?.type !== 'task') return;

  enqueueDocumentIdWakeup(item.id);
}

export function enqueuePreviewWakeup(item: PreviewItem) {
  if (item.loading || item.access !== 'access') return;

  enqueueDocumentWakeup(item);
}
