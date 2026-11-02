import { describe, expect, it } from 'vitest';
import { appearanceColor, readEntityAppearance } from './appearance';

describe('appearance palette transport', () => {
  it('preserves icons when GraphQL reads include the added tag colors', () => {
    for (const color of ['tomato', 'amber', 'indigo']) {
      const value = { icon: { kind: 'macro', name: 'star' }, color };
      expect(readEntityAppearance(value)).toEqual(value);
      expect(appearanceColor(readEntityAppearance(value)?.color)).toMatch(
        /^#[0-9A-F]{6}$/
      );
    }
  });

  it('retains named saved colors and rejects unknown wire colors', () => {
    expect(readEntityAppearance({ icon: null, color: 'blue' })).toEqual({
      icon: null,
      color: 'blue',
    });
    expect(
      readEntityAppearance({
        icon: { kind: 'macro', name: 'star' },
        color: 'unknown',
      })
    ).toBeNull();
    expect(appearanceColor(null)).toBeUndefined();
  });
});
