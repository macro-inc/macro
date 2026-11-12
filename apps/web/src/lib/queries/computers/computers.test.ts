import type { ComputerStatus } from '@service-auth/computers';
import { describe, expect, it } from 'vitest';
import { computerPresenceKey, computerStatusKey } from './computers';

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
