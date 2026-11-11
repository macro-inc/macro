import { expect, test } from 'bun:test';
import {
  age,
  readStamp,
  stampBits,
  summarize,
  treeOf,
  treeTicks,
} from '../measure.ts';

const luma = (bits: readonly number[], width: number): Uint8Array => {
  const frame = new Uint8Array(width * 20);
  const block = Math.floor(width / 40);
  bits.forEach((bit, i) => {
    frame.fill(
      bit === 1 ? 235 : 16,
      8 * width + i * block,
      8 * width + (i + 1) * block
    );
  });
  return frame;
};

test('a stamp survives the round trip, past the 32-bit wrap too', () => {
  for (const ms of [1793000000123, 2 ** 32 + 5, 0])
    expect(readStamp(luma(stampBits(ms), 1280), 1280)).toBe(ms % 2 ** 32);
});

test('a torn stamp reads as torn, not as a wrong time', () => {
  const bits = stampBits(1793000000123).map((bit, i) =>
    i === 20 ? 1 - bit : bit
  );
  expect(readStamp(luma(bits, 1920), 1920)).toBeNull();
});

test('age works across the wrap', () => {
  expect(age(2 ** 32 + 10, 2 ** 32 - 5)).toBe(15);
});

test('summary separates frames read from new page frames', () => {
  const summary = summarize([
    { at: 1000, stamp: 950 },
    { at: 1100, stamp: 950 },
    { at: 1200, stamp: null },
    { at: 1300, stamp: 1280 },
    { at: 2000, stamp: 1950 },
  ]);
  expect(summary.deliveredFps).toBe(4);
  expect(summary.distinctFps).toBe(3);
  expect(summary.torn).toBe(1);
  expect(summary.latencyMs.max).toBe(150);
});

test('too few frames summarize to nothing, not a division by zero', () => {
  expect(summarize([{ at: 1, stamp: 1 }])).toMatchObject({
    frames: 1,
    deliveredFps: 0,
    latencyMs: { p50: null },
  });
});

test("a process's cost includes everything it started", () => {
  // Chromium's work is in its renderer and GPU children, not the browser process.
  const all = [
    { pid: 10, parent: 1, ticks: 5, command: 'chromium' },
    { pid: 11, parent: 10, ticks: 7, command: 'chromium --type=renderer' },
    { pid: 12, parent: 11, ticks: 1, command: 'chromium --type=gpu' },
    { pid: 20, parent: 1, ticks: 100, command: 'other' },
  ];
  expect([...treeOf(all, 10)].sort()).toEqual([10, 11, 12]);
  expect(treeTicks(all, 10)).toBe(13);
  expect(treeTicks(all, undefined)).toBe(0);
});
