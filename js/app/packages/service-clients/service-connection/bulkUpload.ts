import type { UploadFolderStatusUpdate } from '@service-connection/generated/schemas/uploadFolderStatusUpdate';
import { createWebsocketEventEffect } from '@websocket/index';
import { toast } from 'core/component/Toast/Toast';
import type { FromWebsocketMessage } from './websocket';
import { ws } from './websocket';

const BULK_UPLOAD_WEBSOCKET_EVENT = 'bulk_upload';
type BulkUploadEventType = FromWebsocketMessage['type'];

// Store upload results by requestId
const uploadResults: Map<string, string | undefined> = new Map();

// Max wait time for upload status (folders can take a while)
const MAX_UPLOAD_WAIT_MS = 300000; // 5 minutes
const POLL_INTERVAL_MS = 100; // Check every 100ms
const RESULT_CLEANUP_DELAY_MS = 10000; // Keep results for 10 seconds after receiving

/**
 * Wait for a folder upload to complete and return the projectId
 * @param requestId The request ID from the folder upload
 * @returns Promise that resolves to projectId if successful, undefined if failed/timeout
 */
export function waitBulkUploadStatus(
  requestId: string
): Promise<string | undefined> {
  // If result already exists, return it immediately
  if (uploadResults.has(requestId)) {
    const result = uploadResults.get(requestId);
    return Promise.resolve(result);
  }

  return new Promise<string | undefined>((resolve) => {
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let nullTimeout: ReturnType<typeof setTimeout> | undefined;

    // Set timeout to resolve with undefined if nothing arrives
    nullTimeout = setTimeout(() => {
      if (pollInterval) clearInterval(pollInterval);
      console.error('timed out waiting for upload result', requestId);
      toast.alert('Upload is taking a while. Try refreshing the page');
      resolve(undefined);
    }, MAX_UPLOAD_WAIT_MS);

    // Poll for results at regular intervals
    pollInterval = setInterval(() => {
      if (uploadResults.has(requestId)) {
        const result = uploadResults.get(requestId);

        if (nullTimeout) clearTimeout(nullTimeout);
        if (pollInterval) clearInterval(pollInterval);

        resolve(result);
      }
    }, POLL_INTERVAL_MS);
  });
}

// Handle bulk upload status updates (global handler for toasts and refetching)
createWebsocketEventEffect<
  BulkUploadEventType,
  FromWebsocketMessage & { type: BulkUploadEventType }
>(ws, BULK_UPLOAD_WEBSOCKET_EVENT, (wsData) => {
  try {
    const update: UploadFolderStatusUpdate = JSON.parse(wsData.data);

    let projectId: string | undefined;
    switch (update.status) {
      case 'partially_completed':
        projectId = update.projectId;
        break;
      case 'completed':
        projectId = update.projectId;
        break;
      case 'failed':
        break;
      case 'unknown':
        // it may or may not have completed, so refetch resources anyway
        break;
      default:
        console.warn('unhandled bulk upload status', update);
        break;
    }

    const requestId = update.requestId;
    if (!requestId) {
      console.error('got upload result without requestId', update);
      return;
    }

    // Store the result for waiters to pick up
    uploadResults.set(requestId, projectId);

    // Clean up result after delay to prevent memory leak
    setTimeout(() => {
      uploadResults.delete(requestId);
    }, RESULT_CLEANUP_DELAY_MS);
  } catch (e) {
    console.warn('unable to parse bulk upload status update', e);
  }
});
