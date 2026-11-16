import { describe, expect, it, vi } from 'vitest';

vi.mock('@entity', () => ({ isTaskEntity: () => false }));

import {
  entityTypeToItemType,
  macroEntityToPropertyEntityType,
  parseEntityType,
} from './entityConversion';

describe('entityTypeToItemType', () => {
  it('has no preview for an entity type a newer service added', () => {
    const fromNewerService = JSON.parse('"AGENT_SESSION"');

    expect(entityTypeToItemType(fromNewerService)).toBeUndefined();
  });

  it('previews a call record as a call', () => {
    expect(entityTypeToItemType('CALL_RECORD')).toBe('call');
  });
});

describe('parseEntityType', () => {
  it('accepts a properties-service entity type', () => {
    expect(parseEntityType('CONTACT')).toBe('CONTACT');
  });

  it('rejects an entity type the properties service does not have', () => {
    expect(parseEntityType('AGENT_SESSION')).toBeUndefined();
  });
});

it('notification-only Team is rejected as a property mutation target', () => {
  expect(() =>
    macroEntityToPropertyEntityType({
      type: 'team',
      id: 'team-1',
      name: 'Synthetic team',
      ownerId: 'viewer',
    })
  ).toThrow();
});
