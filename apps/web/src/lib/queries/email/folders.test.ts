import {
  ChannelListSoupDocument,
  MailFolderSoupDocument,
  SetEmailThreadStateDocument,
  type SetEmailThreadStateInput,
  SoupDocument,
} from '@service-storage/graphql/generated/graphql';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  mutation: vi.fn(),
  invalidate: vi.fn(),
  invalidateSoup: vi.fn(),
  spanActive: false,
  cache: false,
}));
vi.mock('@service-storage/graphql-soup', () => {
  const client = { mutation: mocks.mutation };
  return {
    getGraphqlSoupClient: () => client,
    getGraphqlCacheHost: () => (mocks.cache ? {} : undefined),
  };
});
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../soup/normalized-cache', () => ({
  invalidateAllSoup: mocks.invalidateSoup,
}));
vi.mock('@macro-inc/observability', () => {
  // Match the browser context manager: active context ends at an await.
  const run = <T>(work: () => T): T => {
    const previous = mocks.spanActive;
    mocks.spanActive = true;
    try {
      return work();
    } finally {
      mocks.spanActive = previous;
    }
  };
  return {
    Telemetry: {
      captureContext: () => ({
        run: mocks.spanActive ? run : <T>(work: () => T) => work(),
      }),
      span: (_name: string, work: (span: unknown) => unknown) =>
        run(() => work({ setAttr: vi.fn(), error: vi.fn(), run })),
    },
  };
});

import { restoreEmailFolderThreads } from './folders';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache = false;
  mocks.mutation.mockImplementation(
    (_document, { input }: { input: SetEmailThreadStateInput }) => ({
      toPromise: async () => {
        await mocks.update(input);
        return { data: { setEmailThreadState: { id: input.threadId } } };
      },
    })
  );
});

describe('restore provider folders', () => {
  it.each([
    ['spam', 'JUNK'],
    ['trash', 'TRASHED'],
  ] as const)(
    'restores %s and invalidates mailbox operations for successful threads',
    async (folder, field) => {
      mocks.update.mockResolvedValue(undefined);
      const result = await restoreEmailFolderThreads({
        folder,
        threadIds: ['one', 'one', 'two'],
      });
      expect(mocks.update.mock.calls).toEqual([
        [{ threadId: 'one', field, value: false }],
        [{ threadId: 'two', field, value: false }],
      ]);
      expect(result).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
      expect(mocks.mutation.mock.calls[0]?.[0]).toBe(
        SetEmailThreadStateDocument
      );
      expect(mocks.invalidate).toHaveBeenCalledTimes(2);
      expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
    }
  );

  it('keeps failed IDs separate without undoing successful restores', async () => {
    mocks.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Access denied'));
    const result = await restoreEmailFolderThreads({
      folder: 'spam',
      threadIds: ['one', 'two'],
    });
    expect(result).toEqual({ restoredIds: ['one'], failedIds: ['two'] });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('does not refresh lists when every request fails', async () => {
    mocks.update.mockRejectedValue(new Error('Offline'));
    const result = await restoreEmailFolderThreads({
      folder: 'trash',
      threadIds: ['one'],
    });
    expect(result.failedIds).toEqual(['one']);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.invalidateSoup).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'bounds foreground writes (cache=%s) and continues after a partial failure',
    async (cache) => {
      mocks.cache = cache;
      const concurrency = cache ? 1 : 8;
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
        async ({ threadId }: { threadId: string }) => {
          active++;
          peak = Math.max(peak, active);
          if (active === concurrency) started();
          if (Number(threadId) < concurrency) await firstBatch;
          active--;
          if (threadId === '3') throw new Error('Provider unavailable');
        }
      );
      const result = restoreEmailFolderThreads({
        folder: 'trash',
        threadIds: Array.from({ length: 25 }, (_, i) => String(i)),
      });
      await batchStarted;
      expect(mocks.update).toHaveBeenCalledTimes(concurrency);
      release();
      expect(await result).toEqual({
        restoredIds: Array.from({ length: 25 }, (_, i) => String(i)).filter(
          (id) => id !== '3'
        ),
        failedIds: ['3'],
      });
      expect(peak).toBe(concurrency);
      expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
    }
  );

  it('attaches only server-owned lists to a queued restore', async () => {
    const folder = {
      document: MailFolderSoupDocument,
      variables: {
        input: { initial: { emailView: 'TRASH', limit: 25 } },
        page: 'TRASH:test',
      },
    };
    const inbox = {
      document: SoupDocument,
      variables: {
        input: { initial: { emailView: 'INBOX', limit: 25 } },
      },
    };
    onTestFinished(registerGraphqlSoupRevalidations(() => [folder]));
    onTestFinished(
      registerGraphqlSoupRevalidations(() => [
        {
          document: ChannelListSoupDocument,
          variables: { input: { initial: { limit: 25 } } },
        },
      ])
    );
    onTestFinished(
      registerGraphqlSoupRevalidations(
        () => [inbox],
        undefined,
        () => true
      )
    );
    mocks.mutation.mockReturnValueOnce({
      toPromise: async () => ({
        extensions: {
          normalizedCacheMutationDisposition: {
            kind: 'queued',
            transactionId: '1',
          },
        },
      }),
    });

    await expect(
      restoreEmailFolderThreads({ folder: 'trash', threadIds: ['one'] })
    ).resolves.toEqual({ restoredIds: ['one'], failedIds: [] });
    expect(mocks.mutation).toHaveBeenCalledWith(
      SetEmailThreadStateDocument,
      { input: { threadId: 'one', field: 'TRASHED', value: false } },
      { optimisticMutation: { revalidations: [folder] } }
    );
  });

  it('preserves accepted restores when refreshing one thread fails', async () => {
    mocks.update.mockResolvedValue(undefined);
    mocks.invalidate.mockRejectedValueOnce(new Error('Refresh timed out'));
    expect(
      await restoreEmailFolderThreads({
        folder: 'spam',
        threadIds: ['one', 'two'],
      })
    ).toEqual({ restoredIds: ['one', 'two'], failedIds: [] });
    expect(mocks.invalidateSoup).toHaveBeenCalledOnce();
  });

  it('keeps writes and follow-up reads in the restore trace across batches', async () => {
    const dispatched: boolean[] = [];
    mocks.update.mockImplementation(async () => {
      dispatched.push(mocks.spanActive);
      await Promise.resolve();
    });
    for (const request of [mocks.invalidate, mocks.invalidateSoup]) {
      request.mockImplementation(async () => {
        dispatched.push(mocks.spanActive);
        await Promise.resolve();
      });
    }
    const ids = Array.from({ length: 9 }, (_, index) => String(index));
    expect(
      await restoreEmailFolderThreads({ folder: 'trash', threadIds: ids })
    ).toEqual({ restoredIds: ids, failedIds: [] });
    expect(dispatched).toHaveLength(19);
    expect(dispatched.every(Boolean)).toBe(true);
    expect(mocks.spanActive).toBe(false);
  });
});
