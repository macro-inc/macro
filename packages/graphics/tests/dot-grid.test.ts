import { expect, it } from 'vitest';
import { dotGridLevels } from '../src/core/dot-grid';

it.each([
  0.01, 0.125, 0.25, 0.5, 1, 2, 4, 7.3848947, 8,
])('keeps coarse dots steady and fine dots faint at scale %s', (scale) => {
  const levels = dotGridLevels(scale);
  expect(levels).toHaveLength(3);
  expect(levels[2]!.opacity).toBe(1);
  for (const level of levels) {
    expect(level.unit).toBeGreaterThanOrEqual(1);
    expect(Math.log(level.unit) / Math.log(4)).toBeCloseTo(
      Math.round(Math.log(level.unit) / Math.log(4))
    );
    expect(level.spacing).toBe(level.unit * scale);
    expect(level.opacity).toBeGreaterThanOrEqual(0);
    expect(level.opacity).toBeLessThanOrEqual(1);
    if (level.spacing <= 4) expect(level.opacity).toBe(0);
    if (level.spacing <= 8) expect(level.opacity).toBeLessThanOrEqual(0.125);
  }
});

it('reveals individual canvas pixels subtly at maximum zoom', () => {
  expect(dotGridLevels(8)[0]).toEqual({ unit: 1, spacing: 8, opacity: 0.125 });
});

it('keeps the opacity at grid intersections continuous when levels change', () => {
  const opacityAt = (scale: number, point: number) =>
    1 -
    dotGridLevels(scale).reduce(
      (remaining, level) =>
        remaining * (point % level.unit === 0 ? 1 - level.opacity : 1),
      1
    );
  for (const scale of [4, 1, 0.25, 0.0625, 0.015625]) {
    for (const point of [0, 1, 4, 16, 64, 256, 1024, 4096]) {
      expect(opacityAt(scale * (1 - 1e-7), point)).toBeCloseTo(
        opacityAt(scale * (1 + 1e-7), point),
        5
      );
    }
  }
});
