import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarLoadingTransition } from './create-calendar-loading-transition';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () =>
  createRoot((dispose) => ({
    transition: createCalendarLoadingTransition(),
    dispose,
  }));

describe('calendar loading transition', () => {
  it('never shows a skeleton for a quick load', () => {
    const { transition, dispose } = setup();
    expect(transition.phase()).toBe('hidden');
    transition.setLoading(true);
    expect(transition.phase()).toBe('waiting');
    vi.advanceTimersByTime(119);
    expect(transition.phase()).toBe('waiting');
    transition.setLoading(false);
    expect(transition.phase()).toBe('hidden');
    vi.runAllTimers();
    expect(transition.phase()).toBe('hidden');
    dispose();
  });

  it('delays a long load and retains the leaving skeleton for 180ms', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    vi.advanceTimersByTime(120);
    expect(transition.phase()).toBe('visible');
    vi.advanceTimersByTime(240);
    transition.setLoading(false);
    expect(transition.phase()).toBe('leaving');
    vi.advanceTimersByTime(179);
    expect(transition.phase()).toBe('leaving');
    vi.advanceTimersByTime(1);
    expect(transition.phase()).toBe('hidden');
    dispose();
  });

  it('keeps a skeleton visible for 240ms even when loading ends early', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    vi.advanceTimersByTime(120);
    vi.advanceTimersByTime(40);
    transition.setLoading(false);
    expect(transition.phase()).toBe('visible');
    vi.advanceTimersByTime(199);
    expect(transition.phase()).toBe('visible');
    vi.advanceTimersByTime(1);
    expect(transition.phase()).toBe('leaving');
    vi.advanceTimersByTime(180);
    expect(transition.phase()).toBe('hidden');
    dispose();
  });

  it('cancels a pending exit when loading restarts during minimum visibility', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    vi.advanceTimersByTime(120);
    transition.setLoading(false);
    vi.advanceTimersByTime(100);
    transition.setLoading(true);
    vi.advanceTimersByTime(300);
    expect(transition.phase()).toBe('visible');
    transition.setLoading(false);
    expect(transition.phase()).toBe('leaving');
    dispose();
  });

  it('restores visibility and cancels removal when loading restarts during leaving', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    vi.advanceTimersByTime(120);
    vi.advanceTimersByTime(240);
    transition.setLoading(false);
    vi.advanceTimersByTime(100);
    transition.setLoading(true);
    expect(transition.phase()).toBe('visible');
    vi.advanceTimersByTime(180);
    expect(transition.phase()).toBe('visible');
    transition.setLoading(false);
    vi.advanceTimersByTime(59);
    expect(transition.phase()).toBe('visible');
    vi.advanceTimersByTime(1);
    expect(transition.phase()).toBe('leaving');
    vi.advanceTimersByTime(180);
    expect(transition.phase()).toBe('hidden');
    dispose();
  });

  it('ignores duplicate loading updates without restarting state timers', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    vi.advanceTimersByTime(80);
    transition.setLoading(true);
    vi.advanceTimersByTime(40);
    expect(transition.phase()).toBe('visible');
    transition.setLoading(false);
    vi.advanceTimersByTime(100);
    transition.setLoading(false);
    vi.advanceTimersByTime(140);
    expect(transition.phase()).toBe('leaving');
    dispose();
  });

  it('notifies phase changes synchronously without repeating the visible phase', () => {
    const onPhaseChange = vi.fn();
    const { transition, dispose } = createRoot((dispose) => ({
      transition: createCalendarLoadingTransition(onPhaseChange),
      dispose,
    }));
    transition.setLoading(true);
    expect(onPhaseChange).toHaveBeenLastCalledWith('waiting');
    vi.advanceTimersByTime(120);
    expect(onPhaseChange).toHaveBeenLastCalledWith('visible');
    transition.setLoading(false);
    expect(onPhaseChange.mock.calls.map(([phase]) => phase)).toEqual([
      'waiting',
      'visible',
    ]);
    vi.advanceTimersByTime(240);
    expect(transition.phase()).toBe('leaving');
    expect(onPhaseChange).toHaveBeenLastCalledWith('leaving');
    vi.advanceTimersByTime(180);
    expect(onPhaseChange).toHaveBeenLastCalledWith('hidden');
    dispose();
  });

  it('ignores loading updates after owner disposal', () => {
    const { transition, dispose } = setup();
    transition.setLoading(true);
    dispose();
    transition.setLoading(true);
    expect(transition.phase()).toBe('hidden');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['waiting', 'visible', 'leaving'] as const)(
    'reset hides immediately and cancels timers during %s',
    (state) => {
      const { transition, dispose } = setup();
      transition.setLoading(true);
      if (state !== 'waiting') vi.advanceTimersByTime(120);
      if (state === 'leaving') {
        vi.advanceTimersByTime(240);
        transition.setLoading(false);
      } else if (state === 'visible') {
        transition.setLoading(false);
      }
      expect(transition.phase()).toBe(state);
      transition.reset();
      expect(transition.phase()).toBe('hidden');
      expect(vi.getTimerCount()).toBe(0);
      vi.runAllTimers();
      expect(transition.phase()).toBe('hidden');
      transition.setLoading(true);
      expect(transition.phase()).toBe('waiting');
      dispose();
    }
  );

  it.each(['waiting', 'visible', 'leaving'] as const)(
    'owner cleanup cancels timers during %s',
    (state) => {
      const { transition, dispose } = setup();
      transition.setLoading(true);
      if (state !== 'waiting') vi.advanceTimersByTime(120);
      if (state === 'leaving') {
        vi.advanceTimersByTime(240);
        transition.setLoading(false);
      } else if (state === 'visible') {
        transition.setLoading(false);
      }
      expect(transition.phase()).toBe(state);
      dispose();
      expect(transition.phase()).toBe('hidden');
      expect(vi.getTimerCount()).toBe(0);
      vi.runAllTimers();
      expect(transition.phase()).toBe('hidden');
    }
  );
});
