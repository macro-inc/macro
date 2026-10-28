import { afterEach, expect, it, vi } from 'vitest';
import type { PeerPresence } from '../src/loro';
import { createPresenceMotion } from '../src/loro/solid/presence-motion';

const peer = (x: number): PeerPresence => ({
  id: 'alice',
  name: 'Alice',
  color: '#ffabcd',
  cursor: { x, y: 0 },
  selectedIds: [],
  clock: {},
  preview: null,
});
const dispose: (() => void)[] = [];
afterEach(() => {
  dispose.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup() {
  vi.useFakeTimers();
  let rendered: PeerPresence[] = [];
  const motion = createPresenceMotion((peers) => {
    rendered = peers;
  });
  dispose.push(motion.dispose);
  return { motion, rendered: () => rendered };
}

it('springs between remote targets, retargets without jumping and stops when settled', () => {
  const { motion, rendered } = setup();
  motion.update([peer(0)]);
  motion.update([peer(100)]);
  expect(rendered()[0]!.cursor!.x).toBe(0);
  vi.advanceTimersByTime(80);
  const intermediate = rendered()[0]!.cursor!.x;
  expect(intermediate).toBeGreaterThan(0);
  expect(intermediate).toBeLessThan(100);
  motion.update([peer(200)]);
  expect(rendered()[0]!.cursor!.x).toBe(intermediate);
  vi.advanceTimersByTime(1000);
  expect(rendered()[0]!.cursor!.x).toBe(200);
  expect(vi.getTimerCount()).toBe(0);
  motion.update([peer(400)]);
  motion.update([]);
  expect(rendered()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('interpolates rotation across the short arc without shrinking or skewing the ghost', () => {
  const { motion, rendered } = setup();
  const rotated = (degrees: number): PeerPresence => {
    const angle = (degrees * Math.PI) / 180;
    return {
      ...peer(0),
      preview: {
        kind: 'rotate',
        box: null,
        shapes: [
          {
            id: 'shape',
            kind: 'rectangle',
            width: 100,
            height: 80,
            world: [
              Math.cos(angle),
              Math.sin(angle),
              -Math.sin(angle),
              Math.cos(angle),
              10,
              20,
            ],
          },
        ],
      },
    };
  };
  motion.update([rotated(170)]);
  motion.update([rotated(-170)]);
  vi.advanceTimersByTime(80);
  const [a, b, c, d] = rendered()[0]!.preview!.shapes[0]!.world;
  expect(a).toBeLessThan(-0.98);
  expect(Math.hypot(a, b)).toBeCloseTo(1, 10);
  expect(a * d - b * c).toBeCloseTo(1, 10);
  // Clear while still moving; no trailing frames may resurrect the preview.
  motion.update([peer(0)]);
  expect(rendered()[0]!.preview).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('honors reduced motion and cancels the frame loop on disposal', () => {
  const media = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => media);
  const { motion, rendered } = setup();
  motion.update([peer(0)]);
  motion.update([peer(100)]);
  expect(rendered()[0]!.cursor!.x).toBe(100);
  expect(vi.getTimerCount()).toBe(0);
  media.matches = false;
  motion.update([peer(200)]);
  expect(vi.getTimerCount()).toBe(1);
  motion.dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(media.removeEventListener).toHaveBeenCalled();
});
