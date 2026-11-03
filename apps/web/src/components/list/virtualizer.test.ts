import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const observers = new Set<MeasuredResizeObserver>();

class MeasuredResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
}

function measure(height: number) {
  for (const observer of [...observers]) {
    const entries = [...observer.targets].map((target) => {
      const blockSize = target.hasAttribute('data-viewport') ? height : 32;
      const size = [{ inlineSize: 300, blockSize }];
      return {
        target,
        contentRect: new DOMRect(0, 0, 300, blockSize),
        borderBoxSize: size,
        contentBoxSize: size,
        devicePixelContentBoxSize: size,
      };
    });
    if (entries.length) observer.callback(entries, observer);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.parentElement;
    }
  );
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(scrollTop: number, initialMargin = 0) {
  const viewport = document.createElement('div');
  viewport.setAttribute('data-viewport', '');
  document.body.append(viewport);
  viewport.scrollTop = scrollTop;
  const [margin, setMargin] = createSignal(initialMargin);
  let handle: VirtualizerHandle | undefined;
  const result = render(
    () =>
      createComponent(Virtualizer<string>, {
        data: Array.from({ length: 100 }, (_, index) => `row-${index}`),
        scrollRef: viewport,
        itemSize: 32,
        bufferSize: 0,
        get startMargin() {
          return margin();
        },
        ref: (value) => {
          handle = value;
        },
        children: (id) => {
          const row = document.createElement('button');
          row.textContent = id;
          return row;
        },
      }),
    { container: viewport }
  );
  return { ...result, viewport, setMargin, handle: () => handle };
}

describe('virtualizer scroll coordinates', () => {
  it('starts at the existing scroll offset without blocking pointer input', () => {
    const view = mount(640);
    measure(200);
    expect(view.queryByText('row-0')).toBeNull();
    expect(view.getByText('row-20')).toBeTruthy();
    expect(
      view.viewport.querySelector('[style*="pointer-events: none"]')
    ).toBeNull();
  });

  it('updates its rendered range when preceding content changes height without scrolling', () => {
    const view = mount(640);
    measure(200);
    view.viewport.dispatchEvent(new Event('scroll'));
    expect(view.getByText('row-20')).toBeTruthy();

    view.setMargin(320);

    expect(view.getByText('row-10')).toBeTruthy();
    expect(view.queryByText('row-20')).toBeNull();
  });

  it('uses absolute offsets for nearest scrolling when the list has a start margin', async () => {
    const view = mount(500, 500);
    measure(600);
    view.viewport.dispatchEvent(new Event('scroll'));
    view.handle()?.scrollToIndex(25, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(732);
  });
});
