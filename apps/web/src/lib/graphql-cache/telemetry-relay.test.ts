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
        createChannel: () => channel as unknown as BroadcastChannel,
        lockManager,
      },
    });

    relay.start();
    await Promise.resolve();
    expect(lockName).toBe('macro:graphql-cache-telemetry-reporter:v1');
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

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      rolloutCohort: 'unknown',
      appVersion: 'unknown',
    });
    expect(JSON.stringify(events)).not.toContain('must-not-pass');
    relay.dispose();
    await leadership;
    expect(channel.closed).toBe(true);
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
