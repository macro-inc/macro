import { describe, expect, it } from 'vitest';
import {
  effectiveSessionStartMode,
  parseSessionStartMode,
} from './session-start-mode';

describe('session start mode', () => {
  it('treats only an explicit background value as background', () => {
    expect(parseSessionStartMode('background')).toBe('background');
    expect(parseSessionStartMode('live')).toBe('live');
    expect(parseSessionStartMode(null)).toBe('live');
    expect(parseSessionStartMode('nope')).toBe('live');
  });

  it('previews background while cmd is held only if the user left live selected', () => {
    expect(effectiveSessionStartMode('live', false)).toBe('live');
    expect(effectiveSessionStartMode('live', true)).toBe('background');
    expect(effectiveSessionStartMode('background', false)).toBe('background');
    expect(effectiveSessionStartMode('background', true)).toBe('background');
  });
});
