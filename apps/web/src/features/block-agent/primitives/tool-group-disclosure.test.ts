// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createToolGroupDisclosure,
  TOOL_GROUP_COMPLETION_DELAY_MS,
  TOOL_GROUP_MIN_VISIBLE_MS,
  TOOL_GROUP_REVEAL_DELAY_MS,
} from './tool-group-disclosure';

const disposers: (() => void)[] = [];

function setup(initialActive = false, defaultOpen?: boolean) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [active, setActive] = createSignal(initialActive);
    return {
      ...createToolGroupDisclosure({ active, defaultOpen }),
      setActive,
      dispose,
    };
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe('tool group disclosure', () => {
  it('keeps historical groups collapsed unless initially opened', () => {
    const closed = setup();
    const opened = setup(false, true);

    vi.runAllTimers();

    expect(closed.expanded()).toBe(false);
    expect(opened.expanded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never expands a batch that completes before the reveal delay', () => {
    const group = setup(true);

    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS - 1);
    expect(group.expanded()).toBe(false);
    group.setActive(false);
    vi.runAllTimers();

    expect(group.expanded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds an automatically opened batch for the minimum visible time', () => {
    const group = setup(true);

    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);
    expect(group.expanded()).toBe(true);
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_MIN_VISIBLE_MS - 1);
    expect(group.expanded()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(false);
  });

  it('keeps long-running work open until completion settles', () => {
    const group = setup(true);

    vi.advanceTimersByTime(60_000);
    expect(group.expanded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_COMPLETION_DELAY_MS - 1);
    expect(group.expanded()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(false);
  });

  it('shares one hold deadline across a hundred more calls', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);

    for (let index = 0; index < 100; index++) {
      group.setActive(false);
      vi.advanceTimersByTime(1);
      group.setActive(true);
    }
    group.setActive(false);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(TOOL_GROUP_MIN_VISIBLE_MS - 101);
    expect(group.expanded()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not close resumed work when the original hold expires', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_MIN_VISIBLE_MS - 1);
    group.setActive(true);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(true);
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_COMPLETION_DELAY_MS);
    expect(group.expanded()).toBe(false);
  });

  it('waits for completion to settle when it occurs near the hold deadline', () => {
    const group = setup(true);
    vi.advanceTimersByTime(
      TOOL_GROUP_REVEAL_DELAY_MS + TOOL_GROUP_MIN_VISIBLE_MS - 1
    );
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_COMPLETION_DELAY_MS - 1);
    expect(group.expanded()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(false);
  });

  it('bridges a short idle gap after the minimum visible time', () => {
    const group = setup(true);
    vi.advanceTimersByTime(
      TOOL_GROUP_REVEAL_DELAY_MS + TOOL_GROUP_MIN_VISIBLE_MS
    );

    group.setActive(false);
    vi.advanceTimersByTime(20);
    expect(group.expanded()).toBe(true);
    group.setActive(true);
    vi.advanceTimersByTime(TOOL_GROUP_COMPLETION_DELAY_MS);

    expect(group.expanded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one completion delay across a hundred short idle gaps', () => {
    const group = setup(true);
    vi.advanceTimersByTime(
      TOOL_GROUP_REVEAL_DELAY_MS + TOOL_GROUP_MIN_VISIBLE_MS
    );

    for (let index = 0; index < 100; index++) {
      group.setActive(false);
      vi.advanceTimersByTime(20);
      expect(group.expanded()).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      group.setActive(true);
    }
    group.setActive(false);
    vi.advanceTimersByTime(TOOL_GROUP_COMPLETION_DELAY_MS);

    expect(group.expanded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not queue reveal timers across many instantaneous batches', () => {
    const group = setup();

    for (let index = 0; index < 100; index++) {
      group.setActive(true);
      vi.advanceTimersByTime(1);
      group.setActive(false);
    }
    vi.runAllTimers();

    expect(group.expanded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a later sustained batch reveal after an earlier batch finished', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS - 1);
    group.setActive(false);
    group.setActive(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS - 1);
    expect(group.expanded()).toBe(false);
    vi.advanceTimersByTime(1);

    expect(group.expanded()).toBe(true);
  });

  it('lets manual expansion cancel reveal and remain open after completion', () => {
    const group = setup(true);
    group.toggle();
    group.setActive(false);
    vi.runAllTimers();

    expect(group.expanded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets manual collapse win across completion and later activity', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);
    group.toggle();
    group.setActive(false);
    group.setActive(true);
    vi.runAllTimers();

    expect(group.expanded()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets manual expansion cancel a pending automatic close', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);
    group.setActive(false);
    group.setExpanded(true);
    vi.runAllTimers();

    expect(group.expanded()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, TOOL_GROUP_REVEAL_DELAY_MS])(
    'cleans up pending timers when disposed after %d ms',
    (elapsed) => {
      const group = setup(true);
      vi.advanceTimersByTime(elapsed);
      expect(vi.getTimerCount()).toBe(1);

      group.dispose();

      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('cleans up both the visible hold and pending completion on disposal', () => {
    const group = setup(true);
    vi.advanceTimersByTime(TOOL_GROUP_REVEAL_DELAY_MS);
    group.setActive(false);
    expect(vi.getTimerCount()).toBe(2);

    group.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });
});
