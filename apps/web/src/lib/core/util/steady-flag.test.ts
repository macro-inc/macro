import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSteadyFlag } from './steady-flag';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup() {
  const [source, setSource] = createSignal(false);
  let dispose = () => {};
  const steady = createRoot((cleanup) => {
    dispose = cleanup;
    return createSteadyFlag(source, 300, 500);
  });
  return { steady, setSource, dispose };
}

it('stays off through bursts shorter than the delay', async () => {
  const flag = setup();
  for (let keystroke = 0; keystroke < 6; keystroke++) {
    flag.setSource(true);
    await vi.advanceTimersByTimeAsync(120);
    expect(flag.steady()).toBe(false);
    flag.setSource(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(flag.steady()).toBe(false);
  }
  flag.dispose();
});

it('turns on after the delay and holds through a brief gap before turning off', async () => {
  const flag = setup();
  flag.setSource(true);
  await vi.advanceTimersByTimeAsync(299);
  expect(flag.steady()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(flag.steady()).toBe(true);

  // A gap between keystrokes does not turn it off and on again.
  flag.setSource(false);
  await vi.advanceTimersByTimeAsync(100);
  flag.setSource(true);
  await vi.advanceTimersByTimeAsync(600);
  expect(flag.steady()).toBe(true);

  // Shown for longer than the hold time already: it turns off at once.
  flag.setSource(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(flag.steady()).toBe(false);
  flag.dispose();
});

it('shows for at least the hold time once it has appeared', async () => {
  const flag = setup();
  flag.setSource(true);
  await vi.advanceTimersByTimeAsync(300);
  flag.setSource(false);
  await vi.advanceTimersByTimeAsync(400);
  expect(flag.steady()).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(flag.steady()).toBe(false);
  flag.dispose();
});

// The overdue timer fires before the task that carries the answer: the delay
// elapsed on the clock while nothing could run.
function blockThreadPastDelay() {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1_300);
  return vi.advanceTimersByTimeAsync(300);
}

it('stays off when the thread was blocked past the delay and the answer was already waiting', async () => {
  const flag = setup();
  flag.setSource(true);
  await blockThreadPastDelay();
  expect(flag.steady()).toBe(false);
  flag.setSource(false);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(flag.steady()).toBe(false);
  flag.dispose();
});

it('still turns on after a blocked thread when the source stays on', async () => {
  const flag = setup();
  flag.setSource(true);
  await blockThreadPastDelay();
  expect(flag.steady()).toBe(false);
  await vi.advanceTimersByTimeAsync(50);
  expect(flag.steady()).toBe(true);
  flag.dispose();
});
