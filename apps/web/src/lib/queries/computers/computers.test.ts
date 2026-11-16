import { ThrownResultError } from '@core/util/result';
import type { ComputerStatus } from '@service-auth/computers';
import { describe, expect, it } from 'vitest';
import {
  computerPresenceKey,
  computerStatusKey,
  retryComputerOffers,
} from './computers';

function computer(id: string, harnessId?: string): ComputerStatus {
  return {
    catalogEntry: 'standard-v1',
    createdAt: '2026-11-10T00:00:00Z',
    diskGib: 100,
    harnessId,
    id,
    memoryGib: 8,
    name: id,
    poweredOn: true,
    size: 'standard',
    status: 'ready',
    vcpus: 4,
  } as ComputerStatus;
}

describe('computerPresenceKey', () => {
  it('changes when a computer runtime connects or drops off', () => {
    const computers = [computer('a', 'harness-a'), computer('b')];

    const before = computerPresenceKey(computers, new Set());
    const after = computerPresenceKey(computers, new Set(['harness-a']));

    expect(before).toBe('a:off,b:off');
    expect(after).toBe('a:on,b:off');
    expect(computerPresenceKey(computers, new Set(['other']))).toBe(before);
  });
});

describe('computerStatusKey', () => {
  it('changes when a computer moves between states', () => {
    const starting = { ...computer('a'), status: 'starting' } as ComputerStatus;

    expect(computerStatusKey([computer('a')])).toBe('a:ready');
    expect(computerStatusKey([starting])).toBe('a:starting');
    expect(computerStatusKey(undefined)).toBe('');
  });
});

describe('retryComputerOffers', () => {
  const failure = (code: string) =>
    new ThrownResultError([{ code, message: 'server wording' }]);

  it('never retries a refusal the server will repeat', () => {
    for (const code of [
      'TEAM_ON_TRIAL',
      'NO_PAID_PLAN',
      'ROLLOUT_DISABLED',
      'FORBIDDEN',
      'NOT_FOUND',
      'HTTP_ERROR',
      'UNAUTHORIZED',
    ]) {
      expect(retryComputerOffers(0, failure(code))).toBe(false);
    }
  });

  it('retries a server or network failure once, and a timeout not at all', () => {
    for (const code of [
      'SERVER_ERROR',
      'COMPUTERS_UNAVAILABLE',
      'BILLING_PROVIDER_FAILED',
      'NETWORK_ERROR',
    ]) {
      expect(retryComputerOffers(0, failure(code))).toBe(true);
      expect(retryComputerOffers(1, failure(code))).toBe(false);
    }
    expect(retryComputerOffers(0, failure('TIMED_OUT'))).toBe(false);
    expect(retryComputerOffers(0, new Error('boom'))).toBe(false);
  });
});
