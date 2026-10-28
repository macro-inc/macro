import { render } from '@solidjs/testing-library';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { onElementConnect } from './onElementConnect';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('releases cleanups and computations made once the element connects', () => {
  // A ref runs before its element is attached, so the connection arrives
  // from a ResizeObserver callback, outside any Solid owner.
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  const [value, setValue] = createSignal(0);
  const reads: number[] = [];
  let cleanups = 0;
  const { unmount } = render(() => (
    <div
      ref={(element) =>
        onElementConnect(element, () => {
          createMemo(() => reads.push(value()));
          onCleanup(() => {
            cleanups += 1;
          });
        })
      }
    />
  ));
  for (const connect of observers) connect();

  unmount();
  setValue(1);

  expect({ cleanups, reads }).toEqual({ cleanups: 1, reads: [0] });
});
