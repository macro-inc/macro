import type { UploadFolderStatusUpdate } from '@service-connection/generated/schemas/uploadFolderStatusUpdate';
import type { GetUploadExtractStatusHandler200 } from '@service-storage/generated/schemas/getUploadExtractStatusHandler200';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-connection/bulkUpload', () => ({
  subscribeBulkUploadResult: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

import {
  FOLDER_UPLOAD_STALLED_AFTER_MS,
  type FolderUploadSources,
  waitForFolderUpload,
} from './folderUploadStatus';

type UploadExtractStatus = GetUploadExtractStatusHandler200['data'];

const MINUTE = 60 * 1000;

/** A server whose status the test sets, and which can push a result. */
function fakeServer() {
  let status: UploadExtractStatus | undefined = {
    status: 'uploaded',
  };
  let push: ((update: UploadFolderStatusUpdate) => void) | undefined;
  let hang = false;
  const sources: FolderUploadSources = {
    readStatus: (): Promise<UploadExtractStatus | undefined> =>
      hang ? new Promise(() => {}) : Promise.resolve(status),
    subscribe: (_requestId, listener) => {
      push = listener;
      return () => {
        push = undefined;
      };
    },
  };
  return {
    sources,
    setStatus: (next: UploadExtractStatus | undefined) => {
      status = next;
    },
    push: (update: UploadFolderStatusUpdate) => push?.(update),
    /** Status requests from now on never answer, as on a dead connection. */
    hangReads: () => {
      hang = true;
    },
    isSubscribed: () => push !== undefined,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForFolderUpload', () => {
  it('keeps following an extraction that runs past five minutes', async () => {
    const server = fakeServer();
    const fractions: (number | null)[] = [];
    const outcome = waitForFolderUpload(
      'request-1',
      (fraction) => fractions.push(fraction),
      server.sources
    );

    for (let stored = 0; stored <= 8000; stored += 1000) {
      server.setStatus({
        status: 'processing',
        progress: { filesTotal: 8500, filesStored: stored, filesFailed: 0 },
      });
      await vi.advanceTimersByTimeAsync(MINUTE);
    }
    server.setStatus({
      status: 'completed',
      projectId: 'folder-1',
      progress: { filesTotal: 8500, filesStored: 8500, filesFailed: 0 },
    });
    await vi.advanceTimersByTimeAsync(3000);

    await expect(outcome).resolves.toEqual({
      status: 'completed',
      projectId: 'folder-1',
    });
    expect(fractions).toContain(4000 / 8500);
    expect(server.isSubscribed()).toBe(false);
  });

  it('ends as soon as the server pushes the result between polls', async () => {
    const server = fakeServer();
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);
    await vi.advanceTimersByTimeAsync(0);

    server.push({
      status: 'completed',
      requestId: 'request-1',
      projectId: 'p',
    });

    await expect(outcome).resolves.toEqual({
      status: 'completed',
      projectId: 'p',
    });
  });

  it('reads the final counts once a partial result is pushed', async () => {
    const server = fakeServer();
    server.setStatus({
      status: 'processing',
      progress: { filesTotal: 814, filesStored: 700, filesFailed: 1 },
    });
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);
    await vi.advanceTimersByTimeAsync(0);

    server.setStatus({
      status: 'partially_completed',
      projectId: 'p',
      progress: { filesTotal: 814, filesStored: 811, filesFailed: 3 },
    });
    server.push({
      status: 'partially_completed',
      requestId: 'request-1',
      projectId: 'p',
    });

    await expect(outcome).resolves.toEqual({
      status: 'partially_completed',
      projectId: 'p',
      progress: { filesTotal: 814, filesStored: 811, filesFailed: 3 },
    });
  });

  it('ends on the pushed result while a status request hangs', async () => {
    const server = fakeServer();
    server.hangReads();
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);
    await vi.advanceTimersByTimeAsync(1000);

    server.push({ status: 'failed', requestId: 'request-1' });

    await expect(outcome).resolves.toEqual({ status: 'failed' });
  });

  it('still gives up as unknown when every status request hangs', async () => {
    const server = fakeServer();
    server.hangReads();
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);

    await vi.advanceTimersByTimeAsync(FOLDER_UPLOAD_STALLED_AFTER_MS + 20000);

    await expect(outcome).resolves.toEqual({ status: 'unknown' });
  });

  it('finds the result by polling when the pushed one is missed', async () => {
    const server = fakeServer();
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);
    await vi.advanceTimersByTimeAsync(9000);

    server.setStatus({ status: 'failed' });
    await vi.advanceTimersByTimeAsync(3000);

    await expect(outcome).resolves.toEqual({ status: 'failed' });
  });

  it('keeps waiting while the status cannot be read', async () => {
    const server = fakeServer();
    server.setStatus(undefined);
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    await expect(
      Promise.race([outcome, Promise.resolve('waiting')])
    ).resolves.toBe('waiting');

    server.setStatus({ status: 'completed', projectId: 'p' });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(outcome).resolves.toEqual({
      status: 'completed',
      projectId: 'p',
    });
  });

  it('gives up as unknown, not failed, once nothing changes for longer than the extractor can run', async () => {
    const server = fakeServer();
    server.setStatus({ status: 'processing' });
    const outcome = waitForFolderUpload('request-1', () => {}, server.sources);

    await vi.advanceTimersByTimeAsync(FOLDER_UPLOAD_STALLED_AFTER_MS + 3000);

    await expect(outcome).resolves.toEqual({ status: 'unknown' });
  });
});
