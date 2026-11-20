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
  it('shows a refused ticket as denied and an unavailable computer as asleep', () => {
    expect(afterConnectFailed('forbidden', 0)).toEqual({
      kind: 'show',
      status: { kind: 'denied', reason: 'cannotWatch' },
    });
    expect(afterConnectFailed('unavailable', 0)).toEqual({
      kind: 'show',
      status: { kind: 'asleep' },
    });
    expect(afterConnectFailed('failed', 1)).toEqual({
      kind: 'retry',
      status: { kind: 'reconnecting', attempt: 2 },
      delayMs: 1000,
    });
  });
});
