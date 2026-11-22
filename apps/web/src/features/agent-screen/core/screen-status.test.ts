import { describe, expect, it } from 'vitest';
import {
  afterConnectFailed,
  afterSessionEnded,
  MAX_RECONNECT_ATTEMPTS,
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
  const recent = { recentlyLive: true };

  it('retries at most 2 s apart, and does not give up after the usual six', () => {
    expect(afterSessionEnded('connectionLost', 0, recent)).toMatchObject({
      kind: 'retry',
      delayMs: 500,
    });
    expect(afterConnectFailed('failed', 2, recent)).toMatchObject({
      kind: 'retry',
      delayMs: 2000,
    });
    expect(afterConnectFailed('failed', 5, recent)).toMatchObject({
      kind: 'retry',
      delayMs: 2000,
    });
    expect(
      afterConnectFailed('failed', MAX_RECONNECT_ATTEMPTS + 3, recent)
    ).toMatchObject({ kind: 'retry', delayMs: 2000 });
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
        lastError: 'tooManySockets',
      })
    ).toEqual(ended);
    expect(afterConnectFailed('tooManyScreens', 0)).toEqual(ended);
  });
});
