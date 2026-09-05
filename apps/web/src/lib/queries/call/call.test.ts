import type { ActiveCallSummary } from '@service-storage/generated/schemas/activeCallSummary';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `call.ts` reads the app-wide query client and service client at module
// load; swap in an isolated client and stubs so the tests exercise only the
// cache-writer logic.
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('@service-call/client', () => ({ callServiceClient: {} }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: vi.fn(), failure: vi.fn(), success: vi.fn() },
}));
vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CALLS: true }));

import { queryClient } from '@queries/client';
import { setActiveCallEndedCache, setActiveCallStartedCache } from './call';
import { callKeys } from './keys';

const summary = (over: Partial<ActiveCallSummary>): ActiveCallSummary => ({
  callId: 'call-1',
  channelId: 'channel-1',
  createdAt: '2026-08-21T09:00:00.000Z',
  createdBy: 'macro|a@test.com',
  participantCount: 2,
  ...over,
});

const started = (over: Partial<CallActiveResponse>): CallActiveResponse => ({
  callId: 'call-new',
  channelId: 'channel-new',
  createdAt: '2026-08-21T10:00:00.000Z',
  createdBy: 'macro|b@test.com',
  ...over,
});

const allActive = () =>
  queryClient.getQueryData<ActiveCallSummary[]>(callKeys.allActive.queryKey);

describe('active call cache writers', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('setActiveCallStartedCache upserts into the all-active list newest first', () => {
    queryClient.setQueryData(callKeys.allActive.queryKey, [summary({})]);

    setActiveCallStartedCache(started({}));

    expect(allActive()?.map((c) => c.callId)).toEqual(['call-new', 'call-1']);
    // The websocket event carries no count; the creator is in the call.
    expect(allActive()?.[0]?.participantCount).toBe(1);
    expect(
      queryClient.getQueryData(callKeys.active('channel-new').queryKey)
    ).toMatchObject({ callId: 'call-new' });
  });

  it('setActiveCallStartedCache replaces a stale entry for the same channel', () => {
    queryClient.setQueryData(callKeys.allActive.queryKey, [
      summary({ callId: 'call-stale', channelId: 'channel-new' }),
    ]);

    setActiveCallStartedCache(started({}));

    expect(allActive()?.map((c) => c.callId)).toEqual(['call-new']);
  });

  it('setActiveCallEndedCache drops the call and clears the per-channel entry', () => {
    queryClient.setQueryData(callKeys.allActive.queryKey, [
      summary({}),
      summary({ callId: 'call-2', channelId: 'channel-2' }),
    ]);
    queryClient.setQueryData(
      callKeys.active('channel-1').queryKey,
      started({ callId: 'call-1', channelId: 'channel-1' })
    );

    setActiveCallEndedCache({ callId: 'call-1', channelId: 'channel-1' });

    expect(allActive()?.map((c) => c.callId)).toEqual(['call-2']);
    expect(
      queryClient.getQueryData(callKeys.active('channel-1').queryKey)
    ).toBeNull();
  });
});
