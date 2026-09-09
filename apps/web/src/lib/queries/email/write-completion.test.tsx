import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { useSaveDraftMutation } from './draft';
import { mountEmailMutation } from './tests/mutation';
import { useSendMessageMutation, useUnscheduleMessageMutation } from './thread';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  send: vi.fn(),
  unschedule: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  track: vi.fn(),
  report: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@service-email/client', () => ({
  emailClient: {
    createDraft: mocks.save,
    sendMessage: mocks.send,
    unscheduleMessage: mocks.unschedule,
  },
}));
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../soup/cache', () => ({
  refetchSoupEntity: mocks.refetch,
  optimisticUpdateSoupEntity: vi.fn(),
}));
vi.mock('../soup/normalized-cache', () => ({ invalidateAllSoup: vi.fn() }));
vi.mock('../undo', () => ({ useUndoableMutation: vi.fn() }));
vi.mock('./graphql/thread', () => ({
  createGraphqlEmailThreadQuery: vi.fn(),
  fetchGraphqlEmailThread: vi.fn(),
  mapGraphqlThreadError: vi.fn(),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({ useFeatureFlag: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: mocks.report },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
});

it('returns the saved identity when a subsequent cache refresh rejects', async () => {
  const response = {
    draft: { db_id: 'draft', thread_db_id: 'thread', link_id: 'inbox' },
  };
  const failure = new Error('Refresh failed');
  mocks.save.mockResolvedValue(ok(response));
  mocks.refetch.mockRejectedValue(failure);
  const mutation = mountEmailMutation(useSaveDraftMutation);
  await expect(
    mutation.mutateAsync({ draft: { subject: 'Saved' } })
  ).resolves.toEqual(response);
  expect(mocks.report).toHaveBeenCalledWith(failure);
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledOnce();
});

it('keeps send successful and reconciles caches when analytics throws', async () => {
  const response = {
    message: { db_id: 'sent', thread_db_id: 'thread', link_id: 'inbox' },
  };
  const failure = new Error('Analytics failed');
  mocks.send.mockResolvedValue(ok(response));
  mocks.track.mockImplementation(() => {
    throw failure;
  });
  const mutation = mountEmailMutation(useSendMessageMutation);
  await expect(
    mutation.mutateAsync({ message: { subject: 'Sent' } })
  ).resolves.toEqual(response);
  expect(mocks.refetch).toHaveBeenCalledWith('thread', 'emailThread');
  expect(mocks.report).toHaveBeenCalledWith(failure);
  expect(mocks.send).toHaveBeenCalledOnce();
});

it('keeps unschedule successful when invalidation throws synchronously', async () => {
  mocks.unschedule.mockResolvedValue(ok(undefined));
  const failure = new Error('Cache failed');
  mocks.invalidate.mockImplementation(() => {
    throw failure;
  });
  const mutation = mountEmailMutation(useUnscheduleMessageMutation);
  await expect(
    mutation.mutateAsync({ draftID: 'draft' })
  ).resolves.toBeUndefined();
  expect(mocks.report).toHaveBeenCalledWith(failure);
});

it('rejects a failed send without running success effects', async () => {
  mocks.send.mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Offline' }])
  );
  const mutation = mountEmailMutation(useSendMessageMutation);
  await expect(
    mutation.mutateAsync({ message: { subject: 'Unsent' } })
  ).rejects.toThrow();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.track).not.toHaveBeenCalled();
  expect(mocks.refetch).not.toHaveBeenCalled();
});
