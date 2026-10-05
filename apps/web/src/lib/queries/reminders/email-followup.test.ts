import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailKeys } from '../email/keys';
import { executeEmailFollowup } from './email-followup';

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  graphql: vi.fn(),
  refreshGraphql: vi.fn(),
  fetchThread: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { reminders: { setEmailFollowup: mocks.write } },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: 'graphql',
  isFeatureEnabled: mocks.graphql,
}));
vi.mock('../client', () => ({
  queryClient: {
    setQueryData: mocks.setData,
    invalidateQueries: mocks.invalidate,
  },
}));
vi.mock('../soup/cache', () => ({ refetchSoupEntity: mocks.refetch }));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refreshGraphql,
}));
vi.mock('../email/graphql/thread', () => ({
  fetchGraphqlEmailThread: mocks.fetchThread,
}));
const result: EmailFollowup = {
  condition: 'if_no_reply',
  linkId: 'inbox',
  remindAt: '2026-12-01T12:00:00Z',
  reminderId: 'reminder',
  revision: 'operation',
  state: 'pending',
  threadId: 'thread',
};
const command: EmailFollowupCommand = {
  type: 'set',
  operationId: 'operation',
  remindAt: result.remindAt,
  condition: result.condition,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.write.mockResolvedValue(ok(result));
});
describe('email follow-up cache reconciliation', () => {
  it('refreshes REST thread and preview state after persistence', async () => {
    const after = vi.fn();
    await expect(
      executeEmailFollowup('thread', command, after)
    ).resolves.toEqual(result);
    expect(after).toHaveBeenCalledWith(result);
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: emailKeys.threadMessages('thread').queryKey,
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: emailKeys.previews._def,
    });
    expect(mocks.refreshGraphql).not.toHaveBeenCalled();
  });
  it('refreshes GraphQL lists and the thread even when host navigation fails', async () => {
    mocks.graphql.mockReturnValue(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        executeEmailFollowup('thread', command, async () => {
          throw new Error('Host disposed');
        })
      ).resolves.toEqual(result);
      expect(mocks.refreshGraphql).toHaveBeenCalledOnce();
      expect(mocks.fetchThread).toHaveBeenCalledWith('thread');
      expect(mocks.refetch).toHaveBeenCalledWith('thread', 'emailThread');
    } finally {
      log.mockRestore();
    }
  });
  it('does not turn a cache failure into a retryable write failure', async () => {
    mocks.invalidate.mockRejectedValue(new Error('Refresh failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(executeEmailFollowup('thread', command)).resolves.toEqual(
        result
      );
    } finally {
      log.mockRestore();
    }
    expect(mocks.write).toHaveBeenCalledOnce();
  });
});
