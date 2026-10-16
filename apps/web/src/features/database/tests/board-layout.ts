import type { Accessor } from 'solid-js';
import { afterEach, beforeEach, vi } from 'vitest';

// JSDOM has no layout. Render all IDs while retaining the real drag surface.
vi.mock('@app/components/kanban/kanban-virtualizer', () => ({
  createKanbanVirtualizer: (options: {
    keys: Accessor<readonly (string | number)[]>;
    getScrollElement: () => HTMLDivElement | undefined;
  }) => ({
    get scrollElement() {
      return options.getScrollElement();
    },
    getVirtualItems: () =>
      options.keys().map((key, index) => ({
        key,
        index,
        start: index * 100,
        size: 100,
      })),
    getTotalSize: () => options.keys().length * 100,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    takeSnapshot: () => [],
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

export function boardLane(label: string): HTMLElement {
  const lane = Array.from(
    document.querySelectorAll<HTMLElement>('[data-kanban-lane]')
  ).find((lane) => lane.getAttribute('aria-label') === label);
  if (!lane) throw new Error(`Missing board lane: ${label}`);
  return lane;
}
