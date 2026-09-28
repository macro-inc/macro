import { afterEach, beforeEach, expect, it, vi } from 'vitest';

class BroadcastChannelStub {
  static instance: BroadcastChannelStub | undefined;
  postMessage = vi.fn();
  handler?: (event: { data: unknown }) => void;
  constructor(readonly name: string) {
    BroadcastChannelStub.instance = this;
  }
  addEventListener(_type: string, handler: (event: { data: unknown }) => void) {
    this.handler = handler;
  }
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('BroadcastChannel', BroadcastChannelStub);
});
afterEach(() => vi.unstubAllGlobals());

it('publishes account-scoped meeting resolutions locally and across tabs', async () => {
  const {
    publishMeetingInvitationResolution,
    subscribeToMeetingInvitationResolutions,
  } = await import('../meeting-invitation-resolution');
  const listener = vi.fn();
  const unsubscribe = subscribeToMeetingInvitationResolutions(listener);
  const resolution = {
    meetingId: 'meeting-1',
    userId: 'macro|recipient@example.com',
    resolvedAt: '2026-09-23T14:00:00Z',
  };
  publishMeetingInvitationResolution(resolution);
  expect(listener).toHaveBeenCalledWith(resolution);
  expect(BroadcastChannelStub.instance?.postMessage).toHaveBeenCalledWith(
    resolution
  );
  expect(
    JSON.parse(
      localStorage.getItem('macro.meeting-invitation-resolution') ?? ''
    )
  ).toEqual(resolution);
  BroadcastChannelStub.instance?.handler?.({ data: resolution });
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});

it('accepts storage fallback delivery and rejects malformed resolutions', async () => {
  const { subscribeToMeetingInvitationResolutions } = await import(
    '../meeting-invitation-resolution'
  );
  const listener = vi.fn();
  const unsubscribe = subscribeToMeetingInvitationResolutions(listener);
  BroadcastChannelStub.instance?.handler?.({
    data: { meetingId: 'meeting-1', userId: 'other' },
  });
  const resolution = {
    meetingId: 'meeting-1',
    userId: 'macro|recipient@example.com',
    resolvedAt: '2026-09-23T14:00:01Z',
  };
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'macro.meeting-invitation-resolution',
      newValue: JSON.stringify(resolution),
    })
  );
  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith(resolution);
  unsubscribe();
});
