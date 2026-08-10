import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockBroadcastChannel {
  static instance: MockBroadcastChannel | undefined;

  readonly postMessage = vi.fn();
  private messageHandler: ((event: { data: unknown }) => void) | undefined;

  constructor(readonly name: string) {
    MockBroadcastChannel.instance = this;
  }

  addEventListener(_type: string, handler: (event: { data: unknown }) => void) {
    this.messageHandler = handler;
  }

  emit(data: unknown) {
    this.messageHandler?.({ data });
  }
}

describe('call resolution signaling', () => {
  beforeEach(() => {
    localStorage.clear();
    MockBroadcastChannel.instance = undefined;
    vi.resetModules();
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes to this tab and both cross-tab transports', async () => {
    const { publishCallResolution, subscribeToCallResolutions } = await import(
      '../call-resolution'
    );
    const handler = vi.fn();
    const unsubscribe = subscribeToCallResolutions(handler);
    const resolution = {
      type: 'answered' as const,
      callId: 'call-1',
      answeredBy: 'macro|person@example.com',
    };

    publishCallResolution(resolution);

    expect(handler).toHaveBeenCalledWith(resolution);
    expect(MockBroadcastChannel.instance?.name).toBe('macro-call-resolution');
    expect(MockBroadcastChannel.instance?.postMessage).toHaveBeenCalledWith(
      resolution
    );
    expect(
      JSON.parse(localStorage.getItem('macro.call-resolution') ?? '')
    ).toEqual(resolution);

    // Both transports can deliver the same cross-tab message.
    MockBroadcastChannel.instance?.emit(resolution);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro.call-resolution',
        newValue: JSON.stringify(resolution),
      })
    );
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('receives valid BroadcastChannel and storage fallback messages', async () => {
    const { subscribeToCallResolutions } = await import('../call-resolution');
    const handler = vi.fn();
    const unsubscribe = subscribeToCallResolutions(handler);
    const answered = {
      type: 'answered',
      callId: 'call-1',
      answeredBy: 'macro|person@example.com',
    };
    const ended = {
      type: 'ended',
      channelId: 'channel-1',
      callId: 'call-2',
    };

    MockBroadcastChannel.instance?.emit(answered);
    MockBroadcastChannel.instance?.emit({ type: 'answered' });
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro.call-resolution',
        newValue: JSON.stringify(ended),
      })
    );

    expect(handler).toHaveBeenNthCalledWith(1, answered);
    expect(handler).toHaveBeenNthCalledWith(2, ended);
    expect(handler).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('createCallResolutionsEffect unsubscribes when its owner is disposed', async () => {
    const { createRoot } = await import('solid-js');
    const { createCallResolutionsEffect, publishCallResolution } = await import(
      '../call-resolution'
    );
    const handler = vi.fn();
    const whileMounted = {
      type: 'ended' as const,
      channelId: 'channel-1',
      callId: 'call-1',
    };

    createRoot((dispose) => {
      createCallResolutionsEffect(handler);
      publishCallResolution(whileMounted);
      dispose();
    });
    publishCallResolution({ ...whileMounted, callId: 'call-2' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(whileMounted);
  });
});

describe('getCallRecordResolution', () => {
  it('resolves an active call after the user has joined, even if they left', async () => {
    const { getCallRecordResolution } = await import('../call-resolution');

    expect(
      getCallRecordResolution(
        {
          callId: 'call-1',
          channelId: 'channel-1',
          isActive: true,
          participants: [
            {
              userId: 'macro|person@example.com',
              joinedAt: '2026-08-10T10:00:00.000Z',
              leftAt: '2026-08-10T10:01:00.000Z',
            },
          ],
        },
        'macro|person@example.com'
      )
    ).toEqual({
      type: 'answered',
      callId: 'call-1',
      answeredBy: 'macro|person@example.com',
    });
  });

  it('keeps ringing when a different user answered', async () => {
    const { getCallRecordResolution } = await import('../call-resolution');

    expect(
      getCallRecordResolution(
        {
          callId: 'call-1',
          channelId: 'channel-1',
          isActive: true,
          participants: [
            {
              userId: 'macro|someone-else@example.com',
              joinedAt: '2026-08-10T10:00:00.000Z',
              leftAt: '2026-08-10T10:01:00.000Z',
            },
          ],
        },
        'macro|person@example.com'
      )
    ).toBeNull();
  });

  it('resolves an inactive call as ended and leaves an unanswered call alone', async () => {
    const { getCallRecordResolution } = await import('../call-resolution');
    const unansweredRecord = {
      callId: 'call-1',
      channelId: 'channel-1',
      isActive: true,
      participants: [],
    };

    expect(
      getCallRecordResolution(unansweredRecord, 'macro|person@example.com')
    ).toBeNull();
    expect(
      getCallRecordResolution(
        { ...unansweredRecord, isActive: false },
        'macro|person@example.com'
      )
    ).toEqual({
      type: 'ended',
      callId: 'call-1',
      channelId: 'channel-1',
    });
  });
});
