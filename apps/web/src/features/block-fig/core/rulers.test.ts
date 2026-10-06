import { describe, expect, it } from 'vitest';
import { rulerStep, rulerTicks } from './rulers';

describe('rulers', () => {
  it('picks readable steps', () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(2)).toBe(50);
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(0.1)).toBe(1000);
  });

  it('lists ticks across a span', () => {
    expect(rulerTicks(-15, 40, 10)).toEqual([-20, -10, 0, 10, 20]);
  });
});
