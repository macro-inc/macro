import { describe, expect, it } from 'vitest';
import {
  appearanceColor,
  readEntityAppearance,
  supportsEntityAppearance,
} from './appearance';

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

  it('keeps icons when newer servers add an unknown color', () => {
    for (const icon of [
      { kind: 'macro', name: 'star' },
      { kind: 'emoji', value: '🚀' },
    ]) {
      expect(readEntityAppearance({ icon, color: 'future-color' })).toEqual({
        icon,
        color: null,
      });
    }
    expect(appearanceColor(null)).toBeUndefined();
  });

  it('keeps colors when newer servers add an unknown icon kind', () => {
    expect(
      readEntityAppearance({
        icon: { kind: 'future-icon', value: 'future' },
        color: 'blue',
      })
    ).toEqual({ icon: null, color: 'blue' });
    expect(readEntityAppearance(null)).toBeNull();
    expect(readEntityAppearance('invalid')).toBeNull();
  });
});

it('supports saved definitions without enabling appearance on excluded entity kinds', () => {
  expect(supportsEntityAppearance({ type: 'saved_view' })).toBe(true);
  expect(supportsEntityAppearance({ type: 'project' })).toBe(false);
  expect(
    supportsEntityAppearance({
      type: 'document',
      fileType: 'md',
      subType: { type: 'task' },
    })
  ).toBe(false);
});
