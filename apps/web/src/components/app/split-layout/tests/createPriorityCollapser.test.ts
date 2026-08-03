import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CollapsibleRegistration,
  createPriorityCollapser,
  type OverflowProbe,
} from '../utils/createPriorityCollapser';

type TestItem = {
  id: string;
  collapsedWidth: number;
  expandedWidth: number;
  collapsed: () => boolean;
};

describe('createPriorityCollapser', () => {
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 0;
    frames = new Map();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushAnimationFrames() {
    while (frames.size > 0) {
      const queued = [...frames.values()];
      frames.clear();
      for (const callback of queued) callback(0);
    }
  }

  function createHarness() {
    const items: TestItem[] = [];
    const transitions: Array<{
      id: string;
      collapsed: boolean;
      silent: boolean;
    }> = [];
    let availableWidth = 85;
    let retryWidth = 100;
    let invalidate = () => {};
    let disposeRoot = () => {};

    const probe: OverflowProbe = {
      measure: () => ({
        requiredWidth:
          20 +
          items.reduce(
            (width, item) =>
              width +
              (item.collapsed() ? item.collapsedWidth : item.expandedWidth),
            0
          ),
        availableWidth,
        retryWidth,
      }),
      observe: (onChange) => {
        invalidate = onChange;
        return () => {};
      },
    };

    const collapser = createRoot((dispose) => {
      disposeRoot = dispose;
      return createPriorityCollapser(probe);
    });

    const register = (
      id: string,
      priority: number,
      expandedWidth: number,
      collapsedWidth: number
    ) => {
      const [collapsed, setCollapsed] = createSignal(false);
      items.push({ id, collapsed, expandedWidth, collapsedWidth });
      collapser.register({
        id,
        priority,
        collapsed,
        setCollapsed: (value, options) => {
          transitions.push({
            id,
            collapsed: value,
            silent: options?.silent ?? false,
          });
          setCollapsed(value);
        },
      } satisfies CollapsibleRegistration);
      return collapsed;
    };

    return {
      dispose: disposeRoot,
      invalidate: () => {
        invalidate();
        flushAnimationFrames();
      },
      register,
      setAvailableWidth: (width: number) => {
        availableWidth = width;
      },
      setRetryWidth: (width: number) => {
        retryWidth = width;
      },
      transitions,
    };
  }

  it('collapses the lowest-priority-number item first and stops once content fits', () => {
    const harness = createHarness();
    const first = harness.register('first', 1, 50, 20);
    const second = harness.register('second', 2, 40, 15);

    harness.invalidate();

    expect(first()).toBe(true);
    expect(second()).toBe(false);
    expect(
      harness.transitions
        .filter(({ collapsed }) => collapsed)
        .map(({ id }) => id)
    ).toEqual(['first']);

    harness.dispose();
  });

  it('expands in reverse priority order as space returns', () => {
    const harness = createHarness();
    const first = harness.register('first', 1, 50, 20);
    const second = harness.register('second', 2, 40, 15);

    harness.setAvailableWidth(60);
    harness.invalidate();
    expect(first()).toBe(true);
    expect(second()).toBe(true);

    harness.transitions.length = 0;
    harness.setAvailableWidth(85);
    harness.setRetryWidth(130);
    harness.invalidate();

    expect(first()).toBe(true);
    expect(second()).toBe(false);
    expect(harness.transitions).toContainEqual({
      id: 'second',
      collapsed: false,
      silent: false,
    });

    harness.dispose();
  });
});
