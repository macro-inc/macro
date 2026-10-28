import { describe, expect, it } from 'vitest';
import { groupOf, toolForKey } from './tools';

describe('tool keys', () => {
  it('selects a group’s remembered tool', () => {
    expect(toolForKey('b', false, 'move', {})).toBe('brush');
    expect(toolForKey('B', false, 'move', { B: 'pencil' })).toBe('pencil');
    expect(toolForKey('q', false, 'move', {})).toBeUndefined();
  });

  it('cycles with Shift', () => {
    expect(toolForKey('M', true, 'marqueeRect', {})).toBe('marqueeEllipse');
    expect(toolForKey('M', true, 'marqueeEllipse', {})).toBe('marqueeRect');
    // From another tool, Shift moves on from the group’s remembered one.
    expect(toolForKey('G', true, 'move', { G: 'gradient' })).toBe('bucket');
    expect(toolForKey('V', true, 'move', {})).toBe('move');
  });

  it('finds a tool’s group', () => {
    expect(groupOf('polygonLasso').key).toBe('L');
    expect(groupOf('ellipse').key).toBe('U');
  });
});
