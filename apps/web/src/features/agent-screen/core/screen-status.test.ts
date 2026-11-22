import { describe, expect, it } from 'vitest';
import {
  afterConnectFailed,
  afterSessionEnded,
  BOOT_RETRY_MS,
  MAX_RECONNECT_ATTEMPTS,
  QUICK_RETRIES,
  TICKET_RATE_WINDOW_MS,
  whileBooting,
} from './screen-status';

describe('afterSessionEnded', () => {
  it('reconnects with a new ticket after a drop or a harness restart, backing off', () => {
    expect(afterSessionEnded('connectionLost', 0)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 1 },
      delayMs: 500,
    });
    expect(afterSessionEnded('shutdown', 3)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 4 },
      delayMs: 4000,
    });
  });

  it('gives up after the last attempt', () => {
    expect(afterSessionEnded('connectionLost', MAX_RECONNECT_ATTEMPTS)).toEqual(
      {
        kind: 'show',
        status: { kind: 'ended', reason: 'failed' },
      }
    );
  });

  it('never reconnects a share someone stopped or access that was revoked', () => {
    expect(afterSessionEnded('stopped', 0)).toEqual({
      kind: 'show',
      status: { kind: 'ended', reason: 'stopped' },
    });
    expect(afterSessionEnded('accessRevoked', 0)).toEqual({
      kind: 'show',
      status: { kind: 'ended', reason: 'accessRevoked' },
    });
    expect(afterSessionEnded('computerOff', 0)).toEqual({
      kind: 'show',
      status: { kind: 'asleep' },
    });
  });
});

describe('afterConnectFailed', () => {
  it('shows a refused ticket as denied and retries a failed one', () => {
    expect(afterConnectFailed('forbidden', 0)).toEqual({
      kind: 'show',
      status: { kind: 'denied', reason: 'cannotWatch' },
    });
    expect(afterConnectFailed('failed', 1)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 2 },
      delayMs: 1000,
    });
  });
});

describe('a connection that was live a moment ago', () => {
  const recent = (quickUsed: number) => ({ recentlyLive: true, quickUsed });

  it('retries at most 2 s apart for its first ten, past the usual six', () => {
    expect(afterSessionEnded('connectionLost', 0, recent(0))).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 1 },
      delayMs: 500,
      quick: true,
    });
    expect(afterConnectFailed('failed', 2, recent(2))).toMatchObject({
      delayMs: 2000,
      quick: true,
    });
    expect(afterConnectFailed('failed', 8, recent(8))).toMatchObject({
      delayMs: 2000,
      quick: true,
    });
  });

  it('then backs off from 4 s, as the cold backoff would after 2 s, and gives up after it', () => {
    const after = (attempt: number) =>
      afterConnectFailed('failed', attempt, recent(QUICK_RETRIES));
    expect(after(QUICK_RETRIES)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: QUICK_RETRIES + 1 },
      delayMs: 4000,
    });
    expect(after(QUICK_RETRIES + 1)).toMatchObject({ delayMs: 8000 });
    expect(after(QUICK_RETRIES + 2)).toMatchObject({ delayMs: 10_000 });
    expect(after(QUICK_RETRIES + 3)).toEqual({
      kind: 'show',
      status: { kind: 'ended', reason: 'failed' },
    });
  });
});

describe('too many screens', () => {
  it('ends without a retry, from the socket or from the ticket', () => {
    const ended = {
      kind: 'show',
      status: { kind: 'ended', reason: 'tooManyScreens' },
    };
    expect(
      afterSessionEnded('error', 0, {
        recentlyLive: true,
        quickUsed: 0,
        lastError: 'tooManySockets',
      })
    ).toEqual(ended);
    expect(afterConnectFailed('tooManyScreens', 0)).toEqual(ended);
  });
});

describe('the ticket rate limit', () => {
  it('waits out the window once, then leaves it to the person', () => {
    expect(afterConnectFailed('rateLimited', 3)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 3, rateLimited: true },
      delayMs: TICKET_RATE_WINDOW_MS,
    });
    expect(
      afterConnectFailed('rateLimited', 3, {
        recentlyLive: false,
        quickUsed: 0,
        afterRateLimit: true,
      })
    ).toEqual({
      kind: 'show',
      status: { kind: 'ended', reason: 'rateLimited' },
    });
  });
});

describe('while the computer boots', () => {
  const waking = { kind: 'waking', turningOn: true } as const;
  const keepWaking = { kind: 'retry', status: waking, delayMs: BOOT_RETRY_MS };

  it('treats an unreachable screen, and "off" until it is on, as the boot', () => {
    expect(whileBooting(afterSessionEnded('error', 0), waking)).toEqual(
      keepWaking
    );
    expect(whileBooting(afterConnectFailed('failed', 9), waking)).toEqual(
      keepWaking
    );
    expect(whileBooting(afterSessionEnded('computerOff', 0), waking)).toEqual(
      keepWaking
    );
  });

  it('lets a final end and the rate limit stand', () => {
    const stopped = afterSessionEnded('stopped', 0);
    expect(whileBooting(stopped, waking)).toBe(stopped);
    const limited = afterConnectFailed('rateLimited', 0);
    expect(whileBooting(limited, waking)).toBe(limited);
    const full = afterConnectFailed('tooManyScreens', 0);
    expect(whileBooting(full, waking)).toBe(full);
  });
});
