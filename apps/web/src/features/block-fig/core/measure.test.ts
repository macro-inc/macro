import { describe, expect, it } from 'vitest';
import { formatMeasure, measure } from './measure';

describe('measure', () => {
  it('measures the gap between separate layers', () => {
    const lines = measure(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toBe(20);
    expect(lines[0].from).toEqual({ x: 10, y: 5 });
  });

  it('measures insets inside a container', () => {
    const lines = measure(
      { x: 10, y: 20, w: 10, h: 10 },
      { x: 0, y: 0, w: 100, h: 100 }
    );
    expect(lines.map((l) => l.value).sort((a, b) => a - b)).toEqual([
      10, 20, 70, 80,
    ]);
  });

  it('measures both axes for diagonal neighbors', () => {
    const lines = measure(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 30, w: 10, h: 10 }
    );
    expect(lines.map((l) => l.value)).toEqual([10, 20]);
  });

  it('formats like Figma', () => {
    expect(formatMeasure(12)).toBe('12');
    expect(formatMeasure(12.345)).toBe('12.35');
  });
});
