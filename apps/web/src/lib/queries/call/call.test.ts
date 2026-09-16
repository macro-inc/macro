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
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import {
  buildCallTeamSharePayload,
  isCallSharedWithTeam,
  setActiveCallEndedCache,
  setActiveCallStartedCache,
  setCallRecordTeamShareCache,
} from './call';
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

const record = (over: Partial<CallRecord>): CallRecord => ({
  callId: 'call-1',
  channelId: 'channel-1',
  createdBy: 'macro|a@test.com',
  isActive: false,
  participants: [],
  roomName: 'room',
  startedAt: '2026-08-21T09:00:00.000Z',
  transcript: [],
  teamShareAccessLevel: null,
  shareWithTeam: false,
  ...over,
});

describe('call team sharing helpers', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('buildCallTeamSharePayload maps the checkbox to view or an explicit clear', () => {
    // Calls only ever share at `view`; `null` (not an omitted field) revokes.
    expect(buildCallTeamSharePayload(true)).toEqual({
      teamShareAccessLevel: 'view',
    });
    expect(buildCallTeamSharePayload(false)).toEqual({
      teamShareAccessLevel: null,
    });
  });

  it('isCallSharedWithTeam covers the live toggle and the archived canonical grant', () => {
    // Live: the pending toggle, no canonical level yet.
    expect(
      isCallSharedWithTeam(
        record({
          isActive: true,
          shareWithTeam: true,
          teamShareAccessLevel: null,
        })
      )
    ).toBe(true);
    // Archived: the boolean mirrors the canonical level.
    expect(
      isCallSharedWithTeam(
        record({
          isActive: false,
          shareWithTeam: true,
          teamShareAccessLevel: 'view',
        })
      )
    ).toBe(true);
    expect(
      isCallSharedWithTeam(
        record({
          isActive: false,
          shareWithTeam: false,
          teamShareAccessLevel: null,
        })
      )
    ).toBe(false);
  });

  it('setCallRecordTeamShareCache updates the level and flag together for archived calls', () => {
    const key = callKeys.record('call-1').queryKey;
    queryClient.setQueryData(key, record({}));

    setCallRecordTeamShareCache('call-1', true);
    expect(queryClient.getQueryData<CallRecord>(key)).toMatchObject({
      teamShareAccessLevel: 'view',
      shareWithTeam: true,
    });

    setCallRecordTeamShareCache('call-1', false);
    expect(queryClient.getQueryData<CallRecord>(key)).toMatchObject({
      teamShareAccessLevel: null,
      shareWithTeam: false,
    });
  });

  it('setCallRecordTeamShareCache only flips the toggle for live calls', () => {
    const key = callKeys.record('call-live').queryKey;
    queryClient.setQueryData(
      key,
      record({ callId: 'call-live', isActive: true, shareWithTeam: false })
    );

    setCallRecordTeamShareCache('call-live', true);
    expect(queryClient.getQueryData<CallRecord>(key)).toMatchObject({
      shareWithTeam: true,
      teamShareAccessLevel: null,
    });
  });

  it('setCallRecordTeamShareCache leaves an unloaded record alone', () => {
    setCallRecordTeamShareCache('missing', true);
    expect(
      queryClient.getQueryData(callKeys.record('missing').queryKey)
    ).toBeUndefined();
  });

  it('setCallRecordTeamShareCache drops a late record fetch', async () => {
    const key = callKeys.record('call-live').queryKey;
    queryClient.setQueryData(
      key,
      record({ callId: 'call-live', isActive: true, shareWithTeam: false })
    );

    let resolveFetch: (value: CallRecord) => void = () => {};
    const pending = new Promise<CallRecord>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchResult = queryClient.fetchQuery({
      queryKey: key,
      staleTime: 0,
      retry: false,
      queryFn: () => pending,
    });

    setCallRecordTeamShareCache('call-live', true);
    resolveFetch(
      record({ callId: 'call-live', isActive: true, shareWithTeam: false })
    );
    await fetchResult.catch(() => undefined);

    expect(queryClient.getQueryData<CallRecord>(key)).toMatchObject({
      shareWithTeam: true,
    });
  });
});
