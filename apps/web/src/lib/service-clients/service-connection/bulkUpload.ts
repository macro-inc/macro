import { createWebsocketEventEffect } from '@macro-inc/collaboration/websocket';
import type { UploadFolderStatusUpdate } from '@service-connection/generated/schemas/uploadFolderStatusUpdate';
import type { FromWebsocketMessage } from './websocket';
import { ws } from './websocket';

const BULK_UPLOAD_WEBSOCKET_EVENT = 'bulk_upload';
type BulkUploadEventType = FromWebsocketMessage['type'];

type BulkUploadListener = (update: UploadFolderStatusUpdate) => void;

const listeners: Map<string, BulkUploadListener> = new Map();

// A result can arrive before its uploader subscribes; keep it briefly.
const earlyResults: Map<string, UploadFolderStatusUpdate> = new Map();
const EARLY_RESULT_LIFETIME_MS = 10000;

/**
 * Calls `listener` with the folder upload's result when the server pushes it.
 * Returns the unsubscribe function.
 */
export function subscribeBulkUploadResult(
  requestId: string,
  listener: BulkUploadListener
): () => void {
  const early = earlyResults.get(requestId);
  if (early) {
    earlyResults.delete(requestId);
    listener(early);
    return () => {};
  }

  listeners.set(requestId, listener);
  return () => {
    if (listeners.get(requestId) === listener) listeners.delete(requestId);
  };
}

createWebsocketEventEffect<
  BulkUploadEventType,
  FromWebsocketMessage & { type: BulkUploadEventType }
>(ws, BULK_UPLOAD_WEBSOCKET_EVENT, (wsData) => {
  try {
    const update: UploadFolderStatusUpdate = JSON.parse(wsData.data);

    const requestId = update.requestId;
    if (!requestId) {
      console.error('got upload result without requestId', update);
      return;
    }

    const listener = listeners.get(requestId);
    if (listener) {
      listener(update);
      return;
    }

    earlyResults.set(requestId, update);
    setTimeout(() => {
      earlyResults.delete(requestId);
    }, EARLY_RESULT_LIFETIME_MS);
  } catch (e) {
    console.warn('unable to parse bulk upload status update', e);
  }
});
