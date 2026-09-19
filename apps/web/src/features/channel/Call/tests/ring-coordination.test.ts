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

type PublishedMessage = { type: string; [key: string]: unknown };

function publishedMessages(type?: string): PublishedMessage[] {
  const calls = MockBroadcastChannel.instance?.postMessage.mock.calls ?? [];
  const messages = calls.map(([message]) => message as PublishedMessage);
  return type ? messages.filter((message) => message.type === type) : messages;
}

function foreignClaim(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'claim',
    callId: 'call-1',
    // Strictly earlier than any claim made under the frozen test clock, so
    // the foreign tab deterministically wins ties.
    claimedAt: Date.now() - 1_000,
    tabId: 'other-tab',
    audible: true,
    sentAt: Date.now(),
    ...overrides,
  };
}

async function importRingCoordination() {
  return await import('../ring-coordination');
}

function createParticipant(
  module: Awaited<ReturnType<typeof importRingCoordination>>,
  overrides: Partial<Parameters<typeof module.participateInRing>[0]> = {}
) {
  const callbacks = {
    onAcquire: vi.fn(),
    onRelease: vi.fn(),
    onEnd: vi.fn(),
  };
  const participation = module.participateInRing({
    callId: 'call-1',
    shouldStop: () => false,
    maxDurationMs: 30_000,
    ...callbacks,
    ...overrides,
  });
  return { participation, ...callbacks };
}

describe('ring coordination', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    localStorage.clear();
    MockBroadcastChannel.instance = undefined;
    vi.resetModules();
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('elects the sole participant immediately and heartbeats its claim', async () => {
    const module = await importRingCoordination();
    const { onAcquire } = createParticipant(module);

    expect(onAcquire).toHaveBeenCalledTimes(1);
    const [claim] = publishedMessages('claim');
    expect(claim).toMatchObject({
      callId: 'call-1',
      claimedAt: 100_000,
      audible: true,
    });
    expect(
      JSON.parse(localStorage.getItem('macro.call-ring') ?? '')
    ).toMatchObject({ type: 'claim', callId: 'call-1' });

    await vi.advanceTimersByTimeAsync(2_000);
    const claims = publishedMessages('claim');
    expect(claims).toHaveLength(3);
    // Heartbeats keep the election key stable while staying unique on the
    // storage transport.
    expect(claims[2]).toMatchObject({ claimedAt: 100_000, sentAt: 102_000 });
  });

  it('stays suppressed while another tab holds a live claim', async () => {
    const module = await importRingCoordination();
    module.attachRingCoordination();
    MockBroadcastChannel.instance?.emit(foreignClaim());

    const { onAcquire, onEnd } = createParticipant(module);

    expect(onAcquire).not.toHaveBeenCalled();
    expect(publishedMessages()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onAcquire).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('records claims arriving over the storage fallback', async () => {
    const module = await importRingCoordination();
    module.attachRingCoordination();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro.call-ring',
        newValue: JSON.stringify(foreignClaim()),
      })
    );

    const { onAcquire } = createParticipant(module);
    expect(onAcquire).not.toHaveBeenCalled();
  });

  it('outranks a claim from a tab that cannot make noise', async () => {
    const module = await importRingCoordination();
    module.attachRingCoordination();
    MockBroadcastChannel.instance?.emit(
      foreignClaim({ audible: false, claimedAt: 99_000 })
    );

    const { onAcquire } = createParticipant(module);

    expect(onAcquire).toHaveBeenCalledTimes(1);
    expect(publishedMessages('claim')[0]).toMatchObject({ audible: true });
  });

  it('defers to an audibly-capable tab when this tab has no user activation', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'userActivation'
    );
    Object.defineProperty(window.navigator, 'userActivation', {
      value: { hasBeenActive: false },
      configurable: true,
    });

    try {
      const module = await importRingCoordination();
      module.attachRingCoordination();
      // Our own claim would be `audible: false`, so a later audible claim
      // from a sibling still wins.
      const { onAcquire, onRelease } = createParticipant(module);
      expect(onAcquire).toHaveBeenCalledTimes(1);
      expect(publishedMessages('claim')[0]).toMatchObject({ audible: false });

      MockBroadcastChannel.instance?.emit(foreignClaim({ claimedAt: 100_500 }));
      expect(onRelease).toHaveBeenCalledTimes(1);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          window.navigator,
          'userActivation',
          originalDescriptor
        );
      } else {
        Reflect.deleteProperty(window.navigator, 'userActivation');
      }
    }
  });

  it('yields to an earlier claim, then takes the ring back once it goes stale', async () => {
    const module = await importRingCoordination();
    const { onAcquire, onRelease, onEnd } = createParticipant(module);
    expect(onAcquire).toHaveBeenCalledTimes(1);

    MockBroadcastChannel.instance?.emit(foreignClaim({ claimedAt: 99_500 }));
    expect(onRelease).toHaveBeenCalledTimes(1);

    // The foreign tab dies silently: no heartbeats. Once its claim exceeds
    // the TTL the suppressed participant re-elects itself.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onAcquire).toHaveBeenCalledTimes(2);
    const claims = publishedMessages('claim');
    expect(claims.at(-1)?.claimedAt).toBeGreaterThan(100_000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('defends its claim against a losing takeover attempt', async () => {
    const module = await importRingCoordination();
    const { onRelease } = createParticipant(module);
    const claimsBefore = publishedMessages('claim').length;

    MockBroadcastChannel.instance?.emit(foreignClaim({ claimedAt: 101_000 }));

    expect(onRelease).not.toHaveBeenCalled();
    // An immediate re-publish tells the usurper the claim is still live.
    expect(publishedMessages('claim')).toHaveLength(claimsBefore + 1);
  });

  it('hands the ring over immediately when the audible tab releases it', async () => {
    const module = await importRingCoordination();
    module.attachRingCoordination();
    MockBroadcastChannel.instance?.emit(foreignClaim());

    const { onAcquire } = createParticipant(module);
    expect(onAcquire).not.toHaveBeenCalled();

    MockBroadcastChannel.instance?.emit({
      type: 'release',
      callId: 'call-1',
      tabId: 'other-tab',
      sentAt: Date.now(),
    });
    expect(onAcquire).toHaveBeenCalledTimes(1);
  });

  it('silence stops the audible ring and prevents any takeover', async () => {
    const module = await importRingCoordination();
    const { onRelease, onEnd } = createParticipant(module);

    MockBroadcastChannel.instance?.emit({
      type: 'silence',
      callId: 'call-1',
      sentAt: Date.now(),
    });
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);

    // A silenced call never rings again in this tab, even without any live
    // competing claim.
    const late = createParticipant(module);
    expect(late.onAcquire).not.toHaveBeenCalled();
    expect(late.onEnd).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(late.onAcquire).not.toHaveBeenCalled();
  });

  it('silenceIncomingCallRing publishes and stops the local ringer', async () => {
    const module = await importRingCoordination();
    const { onRelease, onEnd } = createParticipant(module);

    module.silenceIncomingCallRing('call-1');

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(publishedMessages('silence')).toHaveLength(1);
    expect(
      JSON.parse(localStorage.getItem('macro.call-ring') ?? '')
    ).toMatchObject({ type: 'silence', callId: 'call-1' });
  });

  it('stop() is local-only so siblings can take the ring over', async () => {
    const module = await importRingCoordination();
    const { participation, onRelease, onEnd } = createParticipant(module);

    participation.stop();

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(publishedMessages('silence')).toHaveLength(0);
    expect(publishedMessages('release')).toHaveLength(0);

    // No further heartbeats: the claim is left to go stale.
    const claims = publishedMessages('claim').length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(publishedMessages('claim')).toHaveLength(claims);
  });

  it('ends participation at the ring deadline', async () => {
    const module = await importRingCoordination();
    const { onRelease, onEnd } = createParticipant(module, {
      maxDurationMs: 3_000,
    });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    const claims = publishedMessages('claim').length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(publishedMessages('claim')).toHaveLength(claims);
  });

  it('ends a suppressed participation instead of taking over once shouldStop flips', async () => {
    const module = await importRingCoordination();
    module.attachRingCoordination();
    MockBroadcastChannel.instance?.emit(foreignClaim());

    let stopped = false;
    const { onAcquire, onEnd } = createParticipant(module, {
      shouldStop: () => stopped,
    });
    stopped = true;

    // The foreign claim goes stale, but the participant must not ring for a
    // call the user already joined.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(onAcquire).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('releases the ring on pagehide so survivors take over instantly', async () => {
    const module = await importRingCoordination();
    const { onRelease, onEnd } = createParticipant(module);

    window.dispatchEvent(new Event('pagehide'));

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(publishedMessages('release')).toHaveLength(1);
    expect(publishedMessages('release')[0]).toMatchObject({
      callId: 'call-1',
    });
  });
});
