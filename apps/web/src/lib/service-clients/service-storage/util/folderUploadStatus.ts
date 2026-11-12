import { subscribeBulkUploadResult } from '@service-connection/bulkUpload';
import type { UploadFolderStatusUpdate } from '@service-connection/generated/schemas/uploadFolderStatusUpdate';
import { storageServiceClient } from '@service-storage/client';
import type { GetUploadExtractStatusHandler200 } from '@service-storage/generated/schemas/getUploadExtractStatusHandler200';
import type { UploadFolderProgress } from '@service-storage/generated/schemas/uploadFolderProgress';
import { match } from 'ts-pattern';

type UploadExtractStatus = GetUploadExtractStatusHandler200['data'];

/** How often the uploader asks where its folder upload stands. */
const STATUS_POLL_MS = 3000;

/**
 * The extractor runs for at most 15 minutes, so an upload that shows no change
 * for longer than that will not finish by itself.
 */
export const FOLDER_UPLOAD_STALLED_AFTER_MS = 16 * 60 * 1000;

export type FolderUploadOutcome =
  | { status: 'completed'; projectId: string }
  | {
      status: 'partially_completed';
      projectId: string;
      progress: UploadFolderProgress | undefined;
    }
  | { status: 'failed' }
  /** The server can't say whether the folder was created. */
  | { status: 'unknown' };

export type FolderUploadSources = {
  /** The upload's status, or undefined when it can't be read right now. */
  readStatus: (requestId: string) => Promise<UploadExtractStatus | undefined>;
  /** Calls `listener` with the result the server pushes; returns unsubscribe. */
  subscribe: (
    requestId: string,
    listener: (update: UploadFolderStatusUpdate) => void
  ) => () => void;
};

const SERVER_SOURCES: FolderUploadSources = {
  readStatus: async (requestId) => {
    const result = await storageServiceClient.projects.getUploadExtractStatus({
      requestId,
    });
    return result.isOk() ? result.value : undefined;
  },
  subscribe: subscribeBulkUploadResult,
};

function progressFraction(
  progress: UploadFolderProgress | null | undefined
): number | null {
  if (!progress || progress.filesTotal <= 0) return null;
  return (progress.filesStored + progress.filesFailed) / progress.filesTotal;
}

function outcomeOfStatus(
  status: UploadExtractStatus
): FolderUploadOutcome | undefined {
  const projectId = status.projectId ?? undefined;
  return match(status.status)
    .with('pending', 'uploaded', 'processing', () => undefined)
    .with(
      'completed',
      (): FolderUploadOutcome =>
        projectId ? { status: 'completed', projectId } : { status: 'unknown' }
    )
    .with(
      'partially_completed',
      (): FolderUploadOutcome =>
        projectId
          ? {
              status: 'partially_completed',
              projectId,
              progress: status.progress ?? undefined,
            }
          : { status: 'unknown' }
    )
    .with('failed', (): FolderUploadOutcome => ({ status: 'failed' }))
    .with('unknown', (): FolderUploadOutcome => ({ status: 'unknown' }))
    .exhaustive((): FolderUploadOutcome | undefined => undefined);
}

function outcomeOfUpdate(
  update: UploadFolderStatusUpdate,
  progress: UploadFolderProgress | undefined
): FolderUploadOutcome {
  return match(update)
    .with(
      { status: 'completed' },
      ({ projectId }): FolderUploadOutcome => ({
        status: 'completed',
        projectId,
      })
    )
    .with(
      { status: 'partially_completed' },
      ({ projectId }): FolderUploadOutcome => ({
        status: 'partially_completed',
        projectId,
        progress,
      })
    )
    .with(
      { status: 'failed' },
      (): FolderUploadOutcome => ({ status: 'failed' })
    )
    .with(
      { status: 'unknown' },
      (): FolderUploadOutcome => ({ status: 'unknown' })
    )
    .exhaustive((): FolderUploadOutcome => ({ status: 'unknown' }));
}

/**
 * Follows a sent folder to its end: the result the server pushes over the
 * websocket, or, when that never arrives (a dropped socket, a missed frame),
 * the status the uploader polls. Polling also reports how many files the
 * server has stored. An upload that stops changing for longer than the
 * extractor can run ends as `unknown` rather than as a failure, because the
 * folder may still appear.
 */
export async function waitForFolderUpload(
  requestId: string,
  onProgress: (fraction: number | null) => void,
  sources: FolderUploadSources = SERVER_SOURCES
): Promise<FolderUploadOutcome> {
  const pushed: { update?: UploadFolderStatusUpdate } = {};
  let wake = () => {};
  const unsubscribe = sources.subscribe(requestId, (update) => {
    pushed.update = update;
    wake();
  });

  let progress: UploadFolderProgress | undefined;
  let lastSeen = '';
  let lastChangeAt = Date.now();
  try {
    while (!pushed.update) {
      const status = await sources.readStatus(requestId);
      if (pushed.update) break;

      if (status) {
        const seen = JSON.stringify(status);
        if (seen !== lastSeen) {
          lastSeen = seen;
          lastChangeAt = Date.now();
        }
        progress = status.progress ?? progress;
        onProgress(progressFraction(status.progress));

        const outcome = outcomeOfStatus(status);
        if (outcome) return outcome;
      }

      if (Date.now() - lastChangeAt > FOLDER_UPLOAD_STALLED_AFTER_MS) {
        return { status: 'unknown' };
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STATUS_POLL_MS);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return outcomeOfUpdate(pushed.update, progress);
  } finally {
    unsubscribe();
  }
}
