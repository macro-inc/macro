import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { afterEach, expect, it, vi } from 'vitest';
import { StickyVirtualizer } from './StickyVirtualizer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps virtual offsets finite when pagination introduces new group headers', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const [rows, setRows] = createSignal(Array.from({ length: 10 }, (_, i) => i));
  let handle: VirtualizerHandle | undefined;
  render(() =>
    createComponent(StickyVirtualizer<number>, {
      get data() {
        return rows();
      },
      itemSize: 44,
      isSticky: (row) => row % 5 === 0,
      ref: (value) => {
        handle = value;
      },
      children: (row) => String(row),
    })
  );

  setRows(Array.from({ length: 40 }, (_, i) => i));
  expect(handle).toBeDefined();
  expect(Number.isFinite(handle?.scrollSize)).toBe(true);
  for (let index = 0; index < 40; index += 1) {
    expect(Number.isFinite(handle?.getItemOffset(index))).toBe(true);
  }
  setRows([0, 1, 2, 3, 4]);
  expect(Number.isFinite(handle?.scrollSize)).toBe(true);
});
