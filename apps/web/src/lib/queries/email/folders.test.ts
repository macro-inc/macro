import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  invalidateSoup: vi.fn(),
  refreshLists: vi.fn(),
}));
vi.mock('./cache-cleanup', () => ({
  updateEmailThreadState: mocks.update,
  refreshEmailThreadCache: mocks.refresh,
}));
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../soup/normalized-cache', () => ({
  invalidateAllSoup: mocks.invalidateSoup,
}));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refreshLists,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (_name: string, run: (span: unknown) => unknown) =>
      run({ setAttr: vi.fn(), error: vi.fn() }),
  },
}));

import { restoreEmailFolderThreads } from './folders';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('restore provider folders', () => {
  it.each([
    ['spam', 'junk'],
    ['trash', 'trashed'],
  ] as const)(
    'restores %s through semantic mailbox state and refreshes successful threads',
    async (folder, field) => {
      mocks.update.mockResolvedValue(ok(undefined));
      const result = await restoreEmailFolderThreads({
        folder,
        threadIds: ['one', 'one', 'two'],
      });
      expect(mocks.update.mock.calls).toEqual([
        [{ thread_id: 'one', field, value: false }],
        [{ thread_id: 'two', field, value: false }],
      ]);
      expect(result).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
      expect(mocks.refresh.mock.calls).toEqual([['one'], ['two']]);
      expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
      expect(mocks.refreshLists).toHaveBeenCalledWith({
        unmaintainedOnly: true,
      });
    }
  );

  it('keeps failed IDs separate without undoing successful restores', async () => {
    mocks.update
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(
        err([{ code: 'FORBIDDEN', message: 'Access denied' }])
      );
    const result = await restoreEmailFolderThreads({
      folder: 'spam',
      threadIds: ['one', 'two'],
    });
    expect(result).toEqual({ restoredIds: ['one'], failedIds: ['two'] });
    expect(mocks.refresh.mock.calls).toEqual([['one']]);
  });

  it('does not refresh lists when every request fails', async () => {
    mocks.update.mockRejectedValue(new Error('Offline'));
    const result = await restoreEmailFolderThreads({
      folder: 'trash',
      threadIds: ['one'],
    });
    expect(result.failedIds).toEqual(['one']);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.invalidateSoup).not.toHaveBeenCalled();
  });
  it('bounds bulk writes and continues after a partial batch failure', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const firstBatch = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const batchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.update.mockImplementation(
      async ({ thread_id }: { thread_id: string }) => {
        active++;
        peak = Math.max(peak, active);
        if (active === 8) started();
        if (Number(thread_id) < 8) await firstBatch;
        active--;
        if (thread_id === '3') throw new Error('Provider unavailable');
        return ok(undefined);
      }
    );
    const result = restoreEmailFolderThreads({
      folder: 'trash',
      threadIds: Array.from({ length: 25 }, (_, i) => String(i)),
    });
    await batchStarted;
    expect(mocks.update).toHaveBeenCalledTimes(8);
    release();
    expect(await result).toEqual({
      restoredIds: Array.from({ length: 25 }, (_, i) => String(i)).filter(
        (id) => id !== '3'
      ),
      failedIds: ['3'],
    });
    expect(peak).toBeLessThanOrEqual(8);
    expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
  });

  it('preserves accepted restores when refreshing one thread fails', async () => {
    mocks.update.mockResolvedValue(ok(undefined));
    mocks.refresh.mockRejectedValueOnce(new Error('Refresh timed out'));
    expect(
      await restoreEmailFolderThreads({
        folder: 'spam',
        threadIds: ['one', 'two'],
      })
    ).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
    expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
  });
});
