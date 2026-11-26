import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGlide, pinchStep } from '../src/pan-zoom';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
});
afterEach(() => vi.useRealTimers());

it('reads a pan from the midpoint and a zoom from the spread', () => {
  const step = pinchStep(
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
    [
      { x: 90, y: 140 },
      { x: 290, y: 140 },
    ]
  );
  expect(step).toEqual({
    center: { x: 190, y: 140 },
    pan: { x: 40, y: 40 },
    zoom: 2,
  });
});

it('does not zoom when the fingers share a point', () => {
  const together = { x: 50, y: 50 };
  const step = pinchStep(
    [together, together],
    [
      { x: 40, y: 50 },
      { x: 60, y: 50 },
    ]
  );
  expect(step.zoom).toBe(1);
});

it('keeps moving after a release and eases to a stop', () => {
  const moves: { x: number; y: number }[] = [];
  const glide = createGlide((delta) => {
    moves.push(delta);
    return delta;
  });
  // 1 px/ms to the right.
  glide.track({ x: 0, y: 0 }, 0);
  glide.track({ x: 50, y: 0 }, 50);
  glide.track({ x: 100, y: 0 }, 100);

  expect(glide.release()).toBe(true);
  vi.advanceTimersByTime(2000);

  expect(moves.length).toBeGreaterThan(5);
  expect(moves.every((move) => move.x > 0 && move.y === 0)).toBe(true);
  // Each frame travels less than the one before it.
  for (let index = 1; index < moves.length; index++)
    expect(moves[index]!.x).toBeLessThan(moves[index - 1]!.x);

  // It has stopped: no further frames arrive.
  const settled = moves.length;
  vi.advanceTimersByTime(1000);
  expect(moves).toHaveLength(settled);
});

it('does not glide when the finger rested before lifting', () => {
  const move = vi.fn((delta: { x: number; y: number }) => delta);
  const glide = createGlide(move);
  glide.track({ x: 0, y: 0 }, 0);
  glide.track({ x: 100, y: 0 }, 100);
  // The release reports the same place 400 ms later.
  glide.track({ x: 100, y: 0 }, 500);

  expect(glide.release()).toBe(false);
  vi.advanceTimersByTime(500);
  expect(move).not.toHaveBeenCalled();
});

it('stops an axis that hit a bound and keeps the other going', () => {
  const moves: { x: number; y: number }[] = [];
  const glide = createGlide((delta) => {
    moves.push(delta);
    return { x: 0, y: delta.y };
  });
  glide.track({ x: 0, y: 0 }, 0);
  glide.track({ x: 100, y: 100 }, 100);

  glide.release();
  vi.advanceTimersByTime(200);

  expect(moves[0]!.x).toBeGreaterThan(0);
  expect(moves.slice(1).every((move) => move.x === 0 && move.y > 0)).toBe(true);
});

it('stops at once when the move itself cancels the glide', () => {
  // Moving the content can tear down whatever is gliding.
  const move = vi.fn((delta: { x: number; y: number }) => {
    glide.cancel();
    return delta;
  });
  const glide = createGlide(move);
  glide.track({ x: 0, y: 0 }, 0);
  glide.track({ x: 100, y: 0 }, 100);

  glide.release();
  vi.advanceTimersByTime(500);

  expect(move).toHaveBeenCalledTimes(1);
});

it('stops when cancelled', () => {
  const move = vi.fn((delta: { x: number; y: number }) => delta);
  const glide = createGlide(move);
  glide.track({ x: 0, y: 0 }, 0);
  glide.track({ x: 100, y: 0 }, 100);
  glide.release();
  vi.advanceTimersByTime(40);
  const calls = move.mock.calls.length;

  glide.cancel();
  vi.advanceTimersByTime(500);

  expect(calls).toBeGreaterThan(0);
  expect(move).toHaveBeenCalledTimes(calls);
});
