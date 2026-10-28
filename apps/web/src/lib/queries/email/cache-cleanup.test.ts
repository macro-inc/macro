import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteRecords: vi.fn(),
  query: vi.fn(),
  updateThreadLabel: vi.fn(),
  error: vi.fn(),
  enabled: true,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { updateThreadLabel: mocks.updateThreadLabel },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: mocks.error },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlCacheHost: () =>
    mocks.enabled ? { deleteRecords: mocks.deleteRecords } : undefined,
  getGraphqlSoupClient: () => ({ query: mocks.query }),
}));

import {
  refreshEmailThreadCache,
  updateEmailThreadLabel,
} from './cache-cleanup';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled = true;
});

describe('REST thread cache cleanup', () => {
  const args = { thread_id: 'thread-1', label_id: 'trash', value: true };

  it('rechecks a label-update 404 while preserving the original result', async () => {
    const result = err([{ code: 'NOT_FOUND', message: 'gone' }]);
    mocks.updateThreadLabel.mockResolvedValue(result);
    mocks.query.mockReturnValue({
      toPromise: async () => ({
        data: { user: { emailThread: { id: 'thread-1' } } },
      }),
    });
    expect(await updateEmailThreadLabel(args)).toBe(result);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread-1' }),
      { requestPolicy: 'network-only' }
    );
    // A missing label must not evict a surviving conversation.
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it.each(['NETWORK_ERROR', 'FORBIDDEN', 'SERVER_ERROR'])(
    'does not evict on %s',
    async (code) => {
      mocks.updateThreadLabel.mockResolvedValue(
        err([{ code, message: 'failed' }])
      );
      await updateEmailThreadLabel(args);
      expect(mocks.deleteRecords).not.toHaveBeenCalled();
      expect(mocks.query).not.toHaveBeenCalled();
    }
  );

  it('does not evict a successful update', async () => {
    mocks.updateThreadLabel.mockResolvedValue(ok({}));
    await updateEmailThreadLabel(args);
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('checks the server after REST discard instead of assuming the thread is empty', async () => {
    mocks.query.mockReturnValue({
      toPromise: async () => ({
        data: { user: { emailThread: { id: 'thread-1' } } },
      }),
    });
    await refreshEmailThreadCache('thread-1');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.anything(),
      {
        threadId: 'thread-1',
        offset: 0,
        limit: expect.any(Number),
      },
      { requestPolicy: 'network-only' }
    );
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('does not turn a successful discard into a failure when refresh is offline', async () => {
    mocks.query.mockReturnValue({
      toPromise: async () => {
        throw new Error('offline');
      },
    });
    await expect(refreshEmailThreadCache('thread-1')).resolves.toBeUndefined();
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it('does not initialize a disabled GraphQL cache', async () => {
    mocks.enabled = false;
    await refreshEmailThreadCache('thread-1');
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
