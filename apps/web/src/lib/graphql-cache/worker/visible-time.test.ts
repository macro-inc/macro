import { expect, it } from 'vitest';
import { VisibleTime } from './visible-time';

it('counts only the time it runs', () => {
  let now = 0;
  const time = new VisibleTime(() => now);
  now = 10;
  expect(time.elapsedMs).toBe(0);
  time.setRunning(true);
  now = 15;
  time.setRunning(true);
  expect(time.elapsedMs).toBe(5);
  time.setRunning(false);
  now = 100;
  expect(time.elapsedMs).toBe(5);
  time.setRunning(true);
  now = 103;
  expect(time.elapsedMs).toBe(8);
});
