import { afterEach, expect, it, vi } from 'vitest';
import { createKanbanPointerIntent } from './kanban-pointer-intent';

afterEach(() => vi.useRealTimers());

it('suppresses fast travel, then activates a stationary pointer', () => {
  vi.useFakeTimers();
  const settled = vi.fn();
  const intent = createKanbanPointerIntent({ speed: () => 600, settled });
  intent.reset({ x: 0, y: 0 });
  vi.advanceTimersByTime(16);
  expect(intent.update({ x: 300, y: 0 })).toBe(false);
  expect(intent.update({ x: 300, y: 0 })).toBe(false);
  vi.advanceTimersByTime(99);
  expect(settled).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(settled).toHaveBeenCalledOnce();
  expect(intent.update({ x: 300, y: 0 })).toBe(true);
});

it('accepts slow movement and cancels stale activation after release', () => {
  vi.useFakeTimers();
  const settled = vi.fn();
  const intent = createKanbanPointerIntent({ speed: () => 600, settled });
  intent.reset({ x: 0, y: 0 });
  vi.advanceTimersByTime(16);
  expect(intent.update({ x: 300, y: 0 })).toBe(false);
  vi.advanceTimersByTime(50);
  expect(intent.update({ x: 305, y: 0 })).toBe(true);
  vi.advanceTimersByTime(100);
  expect(settled).not.toHaveBeenCalled();
  expect(intent.update({ x: 700, y: 0 })).toBe(false);
  intent.reset();
  vi.advanceTimersByTime(200);
  expect(settled).not.toHaveBeenCalled();
});

it('leaves default consumers ungated', () => {
  const settled = vi.fn();
  const intent = createKanbanPointerIntent({ speed: () => undefined, settled });
  intent.reset({ x: 0, y: 0 });
  expect(intent.update({ x: 1000, y: 0 })).toBe(true);
});
