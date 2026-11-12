import { subscribeBulkUploadResult } from '@service-connection/bulkUpload';
import type { UploadFolderStatusUpdate } from '@service-connection/generated/schemas/uploadFolderStatusUpdate';
import { storageServiceClient } from '@service-storage/client';
import type { GetUploadExtractStatusHandler200 } from '@service-storage/generated/schemas/getUploadExtractStatusHandler200';
import type { UploadFolderProgress } from '@service-storage/generated/schemas/uploadFolderProgress';
import { match } from 'ts-pattern';

type UploadExtractStatus = GetUploadExtractStatusHandler200['data'];

/** How often the uploader asks where its folder upload stands. */
const STATUS_POLL_MS = 3000;

/** A status read slower than this counts as unreadable for that round. */
const STATUS_READ_TIMEOUT_MS = 15000;

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

type Step =
  | { kind: 'pushed'; update: UploadFolderStatusUpdate }
  | { kind: 'read'; status: UploadExtractStatus | undefined }
  | { kind: 'timeout' };

function after(ms: number): Promise<Step> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ kind: 'timeout' }), ms)
  );
}

async function readStep(
  sources: FolderUploadSources,
  requestId: string
): Promise<Step> {
  try {
    return { kind: 'read', status: await sources.readStatus(requestId) };
  } catch {
    return { kind: 'read', status: undefined };
  }
}

/**
 * Follows a sent folder to its end: the result the server pushes over the
 * websocket, or, when that never arrives (a dropped socket, a missed frame),
 * the status the uploader polls. Polling also reports how many files the
 * server has stored. Every wait races the pushed result, so a slow or hung
 * status request never holds it up. An upload that stops changing for longer
 * than the extractor can run ends as `unknown` rather than as a failure,
 * because the folder may still appear.
 */
export async function waitForFolderUpload(
  requestId: string,
  onProgress: (fraction: number | null) => void,
  sources: FolderUploadSources = SERVER_SOURCES
): Promise<FolderUploadOutcome> {
  let resolvePushed: (step: Step) => void = () => {};
  const pushed = new Promise<Step>((resolve) => {
    resolvePushed = resolve;
  });
  const unsubscribe = sources.subscribe(requestId, (update) =>
    resolvePushed({ kind: 'pushed', update })
  );

  let progress: UploadFolderProgress | undefined;

  // A pushed partial result carries no counts; read them once more so the
  // message names the final number of failed files.
  const finishPushed = async (update: UploadFolderStatusUpdate) => {
    if (update.status === 'partially_completed') {
      const latest = await Promise.race([
        readStep(sources, requestId),
        after(STATUS_READ_TIMEOUT_MS),
      ]);
      if (latest.kind === 'read' && latest.status?.progress) {
        progress = latest.status.progress;
      }
    }
    return outcomeOfUpdate(update, progress);
  };

  let lastSeen = '';
  let lastChangeAt = Date.now();
  try {
    while (true) {
      const step = await Promise.race([
        pushed,
        readStep(sources, requestId),
        after(STATUS_READ_TIMEOUT_MS),
      ]);
      if (step.kind === 'pushed') return await finishPushed(step.update);

      const status = step.kind === 'read' ? step.status : undefined;
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

      const waited = await Promise.race([pushed, after(STATUS_POLL_MS)]);
      if (waited.kind === 'pushed') return await finishPushed(waited.update);
    }
  } finally {
    unsubscribe();
  }
}
