import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailPreparation } from '../email-message/context/email-preparation';
import { createPreparationWindow } from './preparation-window';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const preparation = (): EmailPreparation => ({ acquire: vi.fn() });

it('retains overlapping neighbors and releases the old session independently of Solid', () => {
  const releases: ReturnType<typeof vi.fn>[] = [];
  const start = vi.fn<Parameters<typeof createPreparationWindow>[0]>(() => {
    const release = vi.fn();
    releases.push(release);
    return release;
  });
  const window = createPreparationWindow(start);
  const first = preparation();
  window.update(first, ids, 'c');
  vi.advanceTimersByTime(75);
  expect(start.mock.calls).toEqual([
    [first, 'c', 1],
    [first, 'd', 2],
    [first, 'b', 2],
    [first, 'e', 2],
    [first, 'a', 2],
  ]);
  window.update(first, ids, 'd');
  expect(releases[4]).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(75);
  expect(start).toHaveBeenCalledTimes(6);
  for (const release of releases.slice(0, 4))
    expect(release).not.toHaveBeenCalled();
  window.update(preparation(), ids, 'd');
  for (const release of releases) expect(release).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(75);
  window.dispose();
  window.dispose();
  for (const release of releases) expect(release).toHaveBeenCalledOnce();
  window.update(first, ids, 'a');
  vi.advanceTimersByTime(1000);
  expect(start).toHaveBeenCalledTimes(11);
});

it('does not delay an unchanged selection and cancels superseded intent', () => {
  const start = vi.fn<Parameters<typeof createPreparationWindow>[0]>(() =>
    vi.fn()
  );
  const window = createPreparationWindow(start);
  const service = preparation();
  window.update(service, ids, 'a');
  vi.advanceTimersByTime(50);
  window.update(service, [...ids], 'a');
  vi.advanceTimersByTime(25);
  expect(start.mock.calls.map((call) => call[1])).toEqual(['a', 'b', 'c']);
  window.update(service, ids, 'e');
  vi.advanceTimersByTime(50);
  window.update(service, ids, 'g');
  vi.advanceTimersByTime(75);
  expect(start.mock.calls.slice(3).map((call) => call[1])).toEqual([
    'g',
    'f',
    'e',
  ]);
  window.dispose();
});

it('cancels pending work when disabled, focus disappears, or the owner disposes', () => {
  const start = vi.fn<Parameters<typeof createPreparationWindow>[0]>(() =>
    vi.fn()
  );
  const window = createPreparationWindow(start);
  const service = preparation();
  window.update(service, ids, 'a');
  window.update(undefined, ids, 'a');
  vi.advanceTimersByTime(100);
  window.update(service, ids, 'a');
  window.update(service, ids, 'missing');
  vi.advanceTimersByTime(100);
  window.update(service, ids, 'a');
  window.dispose();
  vi.advanceTimersByTime(100);
  expect(start).not.toHaveBeenCalled();
});
