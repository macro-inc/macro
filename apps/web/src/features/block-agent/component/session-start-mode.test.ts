import { describe, expect, it } from 'vitest';
import {
  effectiveSessionStartMode,
  parseSessionStartMode,
  sessionStartModeFromPointer,
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

  it('maps the left half of the control to live and the right half to background', () => {
    const rect = { left: 100, width: 200 };
    expect(sessionStartModeFromPointer(100, rect)).toBe('live');
    expect(sessionStartModeFromPointer(199, rect)).toBe('live');
    expect(sessionStartModeFromPointer(200, rect)).toBe('background');
    expect(sessionStartModeFromPointer(300, rect)).toBe('background');
  });
});
