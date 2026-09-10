import { describe, expect, it } from 'vitest';
import { isShareableEntityType } from '../shareable-entity';

describe('isShareableEntityType', () => {
  it('accepts the entity types the share modal can open', () => {
    expect(isShareableEntityType('document')).toBe(true);
    expect(isShareableEntityType('chat')).toBe(true);
    expect(isShareableEntityType('project')).toBe(true);
    expect(isShareableEntityType('email')).toBe(true);
  });

  it('rejects entity types with no share flow', () => {
    expect(isShareableEntityType('channel')).toBe(false);
    expect(isShareableEntityType('call')).toBe(false);
    expect(isShareableEntityType('reminder')).toBe(false);
  });
});
