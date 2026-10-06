import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { isShareableEntity, isShareableEntityType } from '../shareable-entity';

describe('isShareableEntityType', () => {
  it('accepts the entity types the share modal can open', () => {
    expect(isShareableEntityType('document')).toBe(true);
    expect(isShareableEntityType('chat')).toBe(true);
    expect(isShareableEntityType('project')).toBe(true);
    expect(isShareableEntityType('email')).toBe(true);
    expect(isShareableEntityType('agent_session')).toBe(true);
  });

  it('rejects entity types with no share flow', () => {
    expect(isShareableEntityType('channel')).toBe(false);
    expect(isShareableEntityType('call')).toBe(false);
    expect(isShareableEntityType('reminder')).toBe(false);
  });
});

describe('isShareableEntity', () => {
  const row = (type: EntityData['type']) =>
    ({
      type,
      id: `${type}-1`,
      name: type,
      ownerId: 'macro|me@macro.com',
    }) as EntityData;

  it('accepts rows of a shareable type', () => {
    expect(isShareableEntity(row('document'))).toBe(true);
    expect(isShareableEntity(row('agent_session'))).toBe(true);
  });

  it('rejects rows with no list share flow', () => {
    expect(isShareableEntity(row('channel'))).toBe(false);
    expect(isShareableEntity(row('initiative'))).toBe(false);
  });
});
