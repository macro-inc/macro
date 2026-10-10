import type { CallEntity, EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  externalCallFilter,
  internalCallFilter,
} from '../../next-soup/filters/call-audience';
import { collectCallChannels, selectCallAudience } from './call-filters';

const call = (overrides: Partial<CallEntity> = {}): CallEntity => ({
  type: 'call',
  id: overrides.id ?? 'call-1',
  name: 'Call',
  ownerId: 'user-1',
  isActive: false,
  status: 'ATTENDED',
  attended: true,
  participantIds: ['user-1'],
  ...overrides,
});

describe('call audience predicates', () => {
  it('treats calls with guests as external', () => {
    const entity = call({ guests: [{ id: 'g', displayName: 'Guest' }] });
    expect(externalCallFilter(entity)).toBe(true);
    expect(internalCallFilter(entity)).toBe(false);
  });

  it('treats calls without guests as internal', () => {
    expect(externalCallFilter(call())).toBe(false);
    expect(internalCallFilter(call({ guests: [] }))).toBe(true);
  });

  it('rejects entities that are not calls', () => {
    const doc = { type: 'document', id: 'd' } as EntityData;
    expect(externalCallFilter(doc)).toBe(false);
    expect(internalCallFilter(doc)).toBe(false);
  });
});

describe('selectCallAudience', () => {
  it('replaces the other audience and keeps unrelated predicates', () => {
    expect(
      selectCallAudience(['calls', 'call-internal'], 'call-external')
    ).toEqual(['calls', 'call-external']);
  });

  it('clears the audience when the active one is chosen again', () => {
    expect(
      selectCallAudience(['calls', 'call-external'], 'call-external')
    ).toEqual(['calls']);
  });
});

describe('collectCallChannels', () => {
  it('adds channels from calls sorted by name and keeps known ones', () => {
    const known = [{ id: 'c-z', name: 'Zeta' }];
    const result = collectCallChannels(known, [
      call({ id: '1', channelId: 'c-a', channelName: 'Alpha' }),
      call({ id: '2', channelId: null }),
      call({ id: '3', channelId: 'c-a', channelName: 'Alpha' }),
    ]);
    expect(result).toEqual([
      { id: 'c-a', name: 'Alpha' },
      { id: 'c-z', name: 'Zeta' },
    ]);
  });

  it('returns the same array when nothing new is seen', () => {
    const known = [{ id: 'c-a', name: 'Alpha' }];
    expect(collectCallChannels(known, [call({ channelId: 'c-a' })])).toBe(
      known
    );
  });
});
