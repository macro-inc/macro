import { cleanup, render } from '@solidjs/testing-library';
import { createComponent, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelRailVirtualizer,
  type ChannelRailVirtualizerHandle,
} from './ChannelRailVirtualizer';

const observers = new Set<MeasuredResizeObserver>();
let viewportHeight = 200;

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
  viewportHeight = height;
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
  viewportHeight = 200;
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-viewport') ? 200 : 32;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
});

afterEach(() => {
  cleanup();
  observers.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(scrollTop: number, initialMargin = 0, scrollPadding = 0) {
  const viewport = document.createElement('div');
  viewport.setAttribute('data-viewport', '');
  document.body.append(viewport);
  viewport.scrollTop = scrollTop;
  const [margin, setMargin] = createSignal(initialMargin);
  const [keys, setKeys] = createSignal(
    Array.from({ length: 100 }, (_, index) => `row-${index}`)
  );
  const [retained, setRetained] = createSignal<number[]>([]);
  const [scrollRoot, setScrollRoot] = createSignal(viewport);
  let handle: ChannelRailVirtualizerHandle | undefined;
  const onRangeChange = vi.fn();
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollTop = options.top ?? 0;
    viewport.dispatchEvent(new Event('scroll'));
  });
  Object.defineProperties(viewport, {
    clientHeight: { get: () => viewportHeight, configurable: true },
    scrollHeight: { get: () => 3200 + margin() },
    scrollTo: { value: scrollTo },
  });
  const result = render(
    () =>
      createComponent(ChannelRailVirtualizer<string>, {
        get keys() {
          return keys();
        },
        get scrollRoot() {
          return scrollRoot();
        },
        estimateSize: 32,
        overscan: 0,
        get scrollMargin() {
          return margin();
        },
        scrollPadding,
        get keepMounted() {
          return retained();
        },
        onRangeChange,
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
  return {
    ...result,
    viewport,
    scrollTo,
    setMargin,
    setKeys,
    setRetained,
    setScrollRoot,
    onRangeChange,
    handle: () => handle,
  };
}

describe('channel rail virtualizer', () => {
  it('starts at an existing scroll offset without blocking pointer input', () => {
    const view = mount(640);
    measure(200);
    expect(view.queryByText('row-0')).toBeNull();
    expect(view.getByText('row-20')).toBeTruthy();
    expect(
      view.viewport.querySelector('[style*="pointer-events: none"]')
    ).toBeNull();
  });

  it('notifies pagination when scrolling unchanged rows near the end', () => {
    const view = mount(0);
    measure(200);
    view.onRangeChange.mockClear();

    view.viewport.scrollTop = 2900;
    view.viewport.dispatchEvent(new Event('scroll'));

    expect(view.onRangeChange).toHaveBeenCalled();
    expect(view.handle()?.scrollMetrics()).toEqual({
      size: 3200,
      offset: 2900,
      viewport: 200,
    });
  });

  it('updates its range when preceding content changes height without scrolling', () => {
    const view = mount(640);
    measure(200);
    expect(view.getByText('row-20')).toBeTruthy();

    view.setMargin(320);

    expect(view.getByText('row-10')).toBeTruthy();
    expect(view.queryByText('row-20')).toBeNull();
  });

  it('includes preceding content in nearest keyboard scrolling', async () => {
    const view = mount(500, 500);
    measure(600);
    view.handle()?.scrollToIndex(25, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(732);
  });

  it('smoothly reveals two context rows above and below the focused row', async () => {
    const view = mount(320, 0, 64);
    measure(200);

    view.handle()?.scrollToIndex(15, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.scrollTo).toHaveBeenCalledWith({
      top: 376,
      behavior: 'smooth',
    });

    view.handle()?.scrollToIndex(10, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(256);
  });

  it('keeps a row still when it already has enough surrounding context', async () => {
    const view = mount(320, 0, 64);
    measure(200);

    view.handle()?.scrollToIndex(13, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(320);
  });

  it('includes preceding sections in padded smooth scrolling', async () => {
    const view = mount(500, 500, 64);
    measure(600);

    view.handle()?.scrollToIndex(25, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(796);
  });

  it('reduces context padding so small viewports can show the focused row', async () => {
    const view = mount(320, 0, 64);
    measure(64);

    view.handle()?.scrollToIndex(15, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.viewport.scrollTop).toBe(464);
  });

  it('uses immediate padded scrolling when reduced motion is requested', async () => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      ...preference,
      matches: true,
    });
    const view = mount(320, 0, 64);
    measure(200);
    view.scrollTo.mockClear();

    view.handle()?.scrollToIndex(15, { align: 'nearest' });
    await vi.advanceTimersByTimeAsync(200);
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 376, behavior: 'auto' });
  });

  it('preserves row elements through refreshed keys and reordering', () => {
    const view = mount(0);
    measure(200);
    const row = view.getByText('row-0');
    const keys = Array.from({ length: 100 }, (_, index) => `row-${index}`);

    view.setKeys([...keys]);
    expect(view.getByText('row-0')).toBe(row);

    view.setKeys([keys[1], keys[0], ...keys.slice(2)]);
    expect(view.getByText('row-0')).toBe(row);
  });

  it('retains focused or dragged rows outside the viewport', () => {
    const view = mount(0);
    measure(200);
    expect(view.queryByText('row-80')).toBeNull();

    view.setRetained([80]);
    const row = view.getByText('row-80');
    view.viewport.scrollTop = 1600;
    view.viewport.dispatchEvent(new Event('scroll'));

    expect(view.getByText('row-80')).toBe(row);
    expect(view.queryByText('row-0')).toBeNull();
  });

  it('uses the new scroll root offset when switching between nested and outer scrolling', () => {
    const view = mount(0);
    measure(200);
    const outer = document.createElement('div');
    outer.setAttribute('data-viewport', '');
    outer.scrollTop = 640;
    document.body.append(outer);
    outer.append(view.viewport);

    view.setScrollRoot(outer);
    measure(200);

    expect(view.queryByText('row-0')).toBeNull();
    expect(view.getByText('row-20')).toBeTruthy();
    outer.remove();
  });
});
