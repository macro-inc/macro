import { describe, expect, it, vi } from 'vitest';
import {
  browserCacheTelemetryContext,
  type CacheTelemetryEnvelope,
  CacheTelemetryReporter,
} from './telemetry';
import {
  CacheTelemetryRelay,
  createPageCacheTelemetry,
} from './telemetry-relay';

class FakeChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  closed = false;
  postMessage(): void {}
  close(): void {
    this.closed = true;
  }
  receive(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

describe('cache telemetry worker relay', () => {
  it('uses one scope-free reporter lock and forwards only validated observations', async () => {
    const channel = new FakeChannel();
    const events: CacheTelemetryEnvelope[] = [];
    let lockName = '';
    let channelName = '';
    let lockCallback: ((lock: Lock | null) => Promise<void> | void) | undefined;
    const lockManager = {
      request: vi.fn(
        async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => Promise<void> | void
        ) => {
          lockName = name;
          lockCallback = callback;
        }
      ),
    } as unknown as Pick<LockManager, 'request'>;
    const { relay } = createPageCacheTelemetry({
      rolloutCohort: 'treatment',
      sink: { emit: (event) => events.push(event) },
      relay: {
        createChannel: (name) => {
          channelName = name;
          return channel as unknown as BroadcastChannel;
        },
        lockManager,
      },
    });

    relay.start();
    await Promise.resolve();
    // An older build's reporter, on v1, would drop events carrying
    // `unavailableReason` whole, so this build reports on its own version.
    expect(channelName).toBe('macro:graphql-cache-telemetry:v3');
    expect(lockName).toBe('macro:graphql-cache-telemetry-reporter:v3');
    const leadership = lockCallback?.({
      name: lockName,
      mode: 'exclusive',
    } as Lock);
    await Promise.resolve();
    channel.receive({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      ownerEvent: 'elected',
      scope: 'must-not-pass',
    });
    channel.receive({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      ownerEvent: 'elected',
    });
    channel.receive({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'error',
      ownerEvent: 'owner-lock-unavailable',
      errorCode: 'lock',
      unavailableReason: 'holder-kept',
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ unavailableReason: 'holder-kept' });
    expect(events[0]).toMatchObject({
      rolloutCohort: 'unknown',
      appVersion: 'unknown',
    });
    expect(JSON.stringify(events)).not.toContain('must-not-pass');
    relay.dispose();
    await leadership;
    expect(channel.closed).toBe(true);
  });

  it('forwards a slow query template from a worker only beside a valid fingerprint', async () => {
    const channel = new FakeChannel();
    const events: CacheTelemetryEnvelope[] = [];
    let lockCallback: ((lock: Lock | null) => Promise<void> | void) | undefined;
    const { relay } = createPageCacheTelemetry({
      rolloutCohort: 'unknown',
      sink: { emit: (event) => events.push(event) },
      relay: {
        createChannel: () => channel as unknown as BroadcastChannel,
        lockManager: {
          request: async (
            _name: string,
            _options: LockOptions,
            callback: (lock: Lock | null) => Promise<void> | void
          ) => {
            lockCallback = callback;
          },
        } as unknown as Pick<LockManager, 'request'>,
      },
    });
    relay.start();
    await Promise.resolve();
    const leadership = lockCallback?.({
      name: 'reporter',
      mode: 'exclusive',
    } as Lock);
    await Promise.resolve();
    const slow = {
      name: 'graphql_cache.slow_query',
      operationCategory: 'storage',
      durationMs: 640,
      outcome: 'success',
      queryTemplate: 'SELECT value FROM records WHERE id IN (?, ?)',
    };
    channel.receive({ ...slow, queryFingerprint: '92389d1ea869911c' });
    channel.receive({ ...slow, queryFingerprint: 'not-a-fingerprint' });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      queryFingerprint: '92389d1ea869911c',
      queryTemplate: slow.queryTemplate,
    });
    expect(events[1]).not.toHaveProperty('queryFingerprint');
    expect(events[1]).not.toHaveProperty('queryTemplate');
    relay.dispose();
    await leadership;
  });

  it('isolates channel failures', () => {
    const relay = new CacheTelemetryRelay(
      new CacheTelemetryReporter(browserCacheTelemetryContext('unknown'), {
        emit: () => undefined,
      }),
      {
        createChannel: () => {
          throw new Error('channel unavailable');
        },
      }
    );

    expect(() => relay.start()).not.toThrow();
    expect(() => relay.dispose()).not.toThrow();
  });

  it('isolates lock failures after creating the channel', () => {
    const channel = new FakeChannel();
    const relay = new CacheTelemetryRelay(
      new CacheTelemetryReporter(browserCacheTelemetryContext('unknown'), {
        emit: () => undefined,
      }),
      {
        createChannel: () => channel as unknown as BroadcastChannel,
        lockManager: {
          request: () => {
            throw new Error('lock unavailable');
          },
        } as unknown as Pick<LockManager, 'request'>,
      }
    );

    expect(() => relay.start()).not.toThrow();
    expect(() => relay.dispose()).not.toThrow();
    expect(channel.closed).toBe(true);
  });
});
