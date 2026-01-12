import { describe, expect, it } from 'vitest';
import {
  expandGroupParticipants,
  toSimpleMention,
} from '../utils/mentionExpansion';

describe('expandGroupParticipants', () => {
  it('converts participant IDs to SimpleMentions', () => {
    const seen = new Set<string>();
    const result = expandGroupParticipants(['u1', 'u2'], seen);
    expect(result).toEqual([
      { entity_type: 'user', entity_id: 'u1' },
      { entity_type: 'user', entity_id: 'u2' },
    ]);
  });

  it('deduplicates against seen set', () => {
    const seen = new Set(['u1']);
    const result = expandGroupParticipants(['u1', 'u2'], seen);
    expect(result).toEqual([{ entity_type: 'user', entity_id: 'u2' }]);
  });
});

describe('toSimpleMention', () => {
  it('converts user mention to SimpleMention', () => {
    const seen = new Set<string>();
    const result = toSimpleMention({ itemType: 'user', itemId: 'u1' }, seen);
    expect(result).toEqual({ entity_type: 'user', entity_id: 'u1' });
  });

  it('returns null for duplicate user mentions', () => {
    const seen = new Set(['u1']);
    const result = toSimpleMention({ itemType: 'user', itemId: 'u1' }, seen);
    expect(result).toBeNull();
  });

  it('passes through non-user types', () => {
    const seen = new Set<string>();
    const result = toSimpleMention(
      { itemType: 'document', itemId: 'd1' },
      seen
    );
    expect(result).toEqual({ entity_type: 'document', entity_id: 'd1' });
  });
});
