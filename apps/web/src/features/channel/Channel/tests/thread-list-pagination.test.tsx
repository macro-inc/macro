import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListNavigation } from '../ThreadList';

const rowHeights = new Map<string, number>();
let viewportHeight = 400;
let viewportWidth = 400;
const resizeCallbacks = new Map<Element, ResizeObserverCallback>();

const platform = vi.hoisted(() => ({ safari: true }));
vi.mock('@solid-primitives/platform', () => ({
  get isSafari() {
    return platform.safari;
  },
  isIOS: false,
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));

beforeEach(() => {
  platform.safari = true;
  rowHeights.clear();
  viewportHeight = 400;
  viewportWidth = 400;
  resizeCallbacks.clear();
  // Supply layout for the real virtualizer; jsdom does not measure DOM nodes.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-index')
        ? (rowHeights.get(this.textContent ?? '') ?? 96)
        : viewportHeight;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    () => viewportWidth
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => viewportWidth
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    () => viewportHeight
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return Number.parseFloat(
        (this.firstElementChild as HTMLElement)?.style.height ?? '0'
      );
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        resizeCallbacks.set(target, this.callback);
      }
      unobserve(target: Element) {
        resizeCallbacks.delete(target);
      }
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      const offset = Math.max(
        0,
        Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight)
      );
      if (offset === this.scrollTop) return;
      this.scrollTop = offset;
      queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

/** Animation frames that run only when a test asks for one. */
function controlFrames() {
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    pending: () => frames.size,
    run: () => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(performance.now());
    },
  };
}

/** Browsers report an observed element once, which measures mounted rows. */
function reportObservedRowsOnce() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [{ target } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
}

function setup(followOnAppend = true, preserveReflowGap = false) {
  const [keys, setKeys] = createSignal(
    Array.from({ length: 20 }, (_, index) => String(index))
  );
  const paginate = vi.fn();
  const onScroll = vi.fn();
  let navigation: ThreadListNavigation | undefined;
  const { container } = render(() => (
    <ThreadList
      preserveReflowGap={preserveReflowGap}
      keys={keys}
      followOnAppend={followOnAppend}
      onReady={(value) => {
        navigation = value;
      }}
      onScrollNearTop={paginate}
      onScroll={onScroll}
    >
      {({ id }) => <div>{id}</div>}
    </ThreadList>
  ));
  const element = container.querySelector<HTMLDivElement>(
    '[data-channel-scroll]'
  )!;
  const prepend = (count: number) => {
    const first = Number(keys()[0]);
    setKeys((previous) => [
      ...Array.from({ length: count }, (_, index) =>
        String(first - count + index)
      ),
      ...previous,
    ]);
  };
  return {
    element,
    paginate,
    prepend,
    setKeys,
    onScroll,
    navigation: () => navigation,
  };
}

describe('history loading ahead of scrolling', () => {
  it.each([false, true])(
    'renders every row of a short list that fits the viewport (safari=%s)',
    async (safari) => {
      platform.safari = safari;
      // The estimated rows fit, so the initial end scroll clamps to zero
      // without emitting a scroll event.
      viewportHeight = 1000;
      const keys = Array.from({ length: 10 }, (_, i) => `row-${i}`);
      for (const key of keys) rowHeights.set(key, 50);
      const { container } = render(() => (
        <ThreadList keys={() => keys}>{({ id }) => <div>{id}</div>}</ThreadList>
      ));
      await waitFor(() =>
        expect(container.querySelectorAll('[data-index]')).toHaveLength(
          keys.length
        )
      );
      const element = container.querySelector<HTMLDivElement>(
        '[data-channel-scroll]'
      )!;
      expect(element.scrollTop).toBe(0);
      expect(element.scrollHeight).toBe(element.clientHeight);
      expect(container.querySelector('[data-index="0"]')?.textContent).toBe(
        keys[0]
      );
    }
  );

  it('preserves a restored history offset during the initial readback', async () => {
    platform.safari = false;
    const keys = Array.from({ length: 20 }, (_, index) => String(index));
    const onScroll = vi.fn();
    const { container } = render(() => (
      <ThreadList
        keys={() => keys}
        initialPosition={{
          type: 'restore',
          snapshot: { scrollOffset: 700, isNearBottom: false },
        }}
        onScroll={onScroll}
      >
        {({ id }) => <div>{id}</div>}
      </ThreadList>
    ));
    await waitFor(() =>
      expect(onScroll).toHaveBeenLastCalledWith(
        expect.objectContaining({ distanceFromTop: 700, isNearBottom: false }),
        expect.objectContaining({ scrollOffset: 700 })
      )
    );
    expect(container.querySelector('[data-channel-scroll]')?.scrollTop).toBe(
      700
    );
  });

  it('fills a bounded Safari buffer before a gesture and preserves the bottom pin', async () => {
    const f = setup();
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
    expect(f.element.scrollTop).toBe(1520);
    // A short page rearms the request without requiring another scroll event.
    f.prepend(2);
    await waitFor(() => expect(f.paginate).toHaveBeenCalledTimes(2));
    f.prepend(10);
    await waitFor(() => expect(f.element.scrollTop).toBe(2672));
    expect(f.paginate).toHaveBeenCalledTimes(2);
    expect(
      f.element.scrollHeight - f.element.clientHeight - f.element.scrollTop
    ).toBe(0);
    // Revisiting history refills the buffer while keeping the reading position.
    f.navigation()?.scrollToMessage('0', { align: 'start' });
    await waitFor(() => expect(f.paginate).toHaveBeenCalledTimes(3));
    const before = f.element.scrollTop;
    f.prepend(20);
    await waitFor(() => expect(f.element.scrollTop).toBe(before + 20 * 96));
    expect(f.paginate).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])(
    'measures rows taller than the estimate ahead of a gesture (safari=%s)',
    async (safari) => {
      platform.safari = safari;
      reportObservedRowsOnce();
      // Rows three times the estimate, as long agent transcripts are: a
      // fling over unmeasured rows hits the native top while history remains.
      const keys = Array.from({ length: 40 }, (_, index) => String(index));
      for (const key of keys) rowHeights.set(key, 300);
      const { container } = render(() => (
        <ThreadList keys={() => keys}>{({ id }) => <div>{id}</div>}</ThreadList>
      ));
      const mounted = () =>
        [...container.querySelectorAll('[data-index]')].map((row) =>
          Number(row.getAttribute('data-index'))
        );
      // Rows 38-39 fill the viewport. Safari measures twelve viewports
      // (4800px, rows 22-37) above them, more than one pass of six unmeasured
      // rows; others mount only the default overscan of six (rows 32-37).
      await waitFor(() => expect(mounted()).toContain(32));
      if (safari) {
        await waitFor(() =>
          expect(Math.min(...mounted())).toBeLessThanOrEqual(22)
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(Math.min(...mounted())).toBe(32);
      }
      expect(Math.max(...mounted())).toBe(39);
    }
  );

  it('paints the first screen before requesting older history', async () => {
    const frames = controlFrames();
    const f = setup();
    await waitFor(() => expect(f.navigation()).toBeDefined());
    expect(f.element.scrollTop).toBe(1520);
    expect(f.paginate).not.toHaveBeenCalled();

    // The frame that paints the first screen, then the one after it.
    frames.run();
    expect(f.paginate).not.toHaveBeenCalled();
    frames.run();
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
  });

  it('requests older history at the first touch when it comes before the paint', async () => {
    controlFrames();
    const f = setup();
    await waitFor(() => expect(f.navigation()).toBeDefined());
    expect(f.paginate).not.toHaveBeenCalled();

    f.element.dispatchEvent(new TouchEvent('touchstart'));
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
  });

  it('measures history one pass a frame once the first screen has painted', async () => {
    const frames = controlFrames();
    reportObservedRowsOnce();
    // Browsers deliver a scroll event with the next frame, not within the task
    // that wrote the offset.
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        const offset = Math.max(
          0,
          Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight)
        );
        if (offset === this.scrollTop) return;
        this.scrollTop = offset;
        requestAnimationFrame(() => this.dispatchEvent(new Event('scroll')));
      },
    });
    const keys = Array.from({ length: 40 }, (_, index) => String(index));
    for (const key of keys) rowHeights.set(key, 300);
    const { container } = render(() => (
      <ThreadList keys={() => keys}>{({ id }) => <div>{id}</div>}</ThreadList>
    ));
    const firstMounted = () =>
      Math.min(
        ...[...container.querySelectorAll('[data-index]')].map((row) =>
          Number(row.getAttribute('data-index'))
        )
      );

    const settle = async () => {
      // Row measurement and the range it changes run in chained microtasks.
      for (let turn = 0; turn < 10; turn++)
        await new Promise<void>((resolve) => queueMicrotask(resolve));
    };

    // Before the paint, only the default overscan of six rows (32-37).
    await waitFor(() => expect(firstMounted()).toBe(32));

    // The frame that paints, then the one that starts the first pass.
    frames.run();
    frames.run();
    await settle();
    const afterFirstPass = firstMounted();
    expect(afterFirstPass).toBeLessThan(32);
    // Twelve viewports (4800px) of 300px rows above row 38 reach row 22;
    // one pass does not get there, and no further pass runs without a frame.
    expect(afterFirstPass).toBeGreaterThan(22);
    await settle();
    expect(firstMounted()).toBe(afterFirstPass);

    for (let frame = 0; frame < 10 && firstMounted() > 22; frame++) {
      frames.run();
      await settle();
    }
    expect(firstMounted()).toBeLessThanOrEqual(22);
  });

  it('ends native scrolling at the latest message while a gesture shifts the rows', async () => {
    const f = setup();
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
    expect(f.element.scrollTop).toBe(1520);
    f.element.dispatchEvent(new TouchEvent('touchstart'));
    // History arriving mid-gesture shifts the rows instead of writing scrollTop.
    f.prepend(10);
    f.element.dispatchEvent(new Event('scroll'));
    await waitFor(() =>
      expect(f.onScroll).toHaveBeenLastCalledWith(
        expect.objectContaining({ distanceFromTop: 2480 }),
        expect.anything()
      )
    );
    expect(f.element.scrollTop).toBe(1520);
    // Scrolling down from here would only reveal blank space below the rows.
    expect(f.element.scrollHeight - f.element.clientHeight).toBe(1520);
    expect(f.onScroll).toHaveBeenLastCalledWith(
      expect.objectContaining({ distanceFromBottom: 0, isNearBottom: true }),
      expect.anything()
    );
    f.element.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    await waitFor(() => expect(f.element.scrollTop).toBe(2480));
    expect(f.element.scrollHeight).toBe(30 * 96);
  });

  it('does not repeat a request for an unchanged boundary', async () => {
    const f = setup();
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
    f.element.dispatchEvent(new Event('scroll'));
    f.navigation()?.scrollToLatest();
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(f.paginate).toHaveBeenCalledOnce();
  });

  it('still requires user intent on browsers without compensation', async () => {
    platform.safari = false;
    const f = setup();
    await waitFor(() => expect(f.navigation()).toBeDefined());
    f.navigation()?.scrollToMessage('0', { align: 'start' });
    await waitFor(() => expect(f.element.scrollTop).toBe(0));
    expect(f.paginate).not.toHaveBeenCalled();
    f.element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, bubbles: true })
    );
    f.element.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(f.paginate).toHaveBeenCalledOnce());
  });
});

describe('server acknowledgement scroll anchoring', () => {
  // Acknowledgements arrive outside gestures, where WebKit writes scrollTop
  // directly too. The mocked scroll events would otherwise start gesture
  // compensation, which hides the offset these tests check.
  beforeEach(() => {
    platform.safari = false;
  });

  it.each([0, 10])(
    'preserves the pin only when already at the end (%ipx gap)',
    async (gap) => {
      rowHeights.set('19', 64);
      rowHeights.set('ack', 160);
      const f = setup();
      await waitFor(() => expect(f.navigation()).toBeDefined());
      f.element.scrollTop -= gap;
      f.element.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      const before = f.element.scrollTop;
      f.setKeys((keys) => [...keys.slice(0, -1), 'ack']);
      await waitFor(() => expect(f.element.scrollHeight).toBe(19 * 96 + 160));
      await waitFor(() =>
        expect(f.element.scrollTop).toBe(
          gap === 0 ? f.element.scrollHeight - 400 : before
        )
      );
    }
  );

  it('does not follow replacements in a window without the latest page', async () => {
    rowHeights.set('19', 64);
    rowHeights.set('ack', 160);
    const f = setup(false);
    await waitFor(() => expect(f.navigation()).toBeDefined());
    const before = f.element.scrollTop;
    f.setKeys((keys) => [...keys.slice(0, -1), 'ack']);
    await waitFor(() => expect(f.element.scrollHeight).toBe(19 * 96 + 160));
    expect(f.element.scrollTop).toBe(before);
  });
});

it('coalesces explicit destination changes into a post-render layout notification', async () => {
  const f = setup();
  await waitFor(() => expect(f.navigation()).toBeDefined());
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  f.onScroll.mockClear();
  const before = f.element.scrollTop;
  f.navigation()?.requestLayoutUpdate();
  f.navigation()?.requestLayoutUpdate();
  expect(f.onScroll).not.toHaveBeenCalled();
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  expect(f.onScroll).toHaveBeenCalledOnce();
  expect(f.element.scrollTop).toBe(before);
  cleanup();
  f.onScroll.mockClear();
  f.navigation()?.requestLayoutUpdate();
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
  expect(f.onScroll).not.toHaveBeenCalled();
});

it('explicit navigation cancels a pending call-thread resize restoration', async () => {
  platform.safari = false;
  const f = setup(true, true);
  await waitFor(() => expect(f.navigation()).toBeDefined());
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const resize = resizeCallbacks.get(f.element);
  expect(resize).toBeDefined();
  viewportWidth = 600;
  resize?.(
    [
      {
        target: f.element,
        contentRect: new DOMRect(0, 0, 600, 400),
        borderBoxSize: [{ inlineSize: 600, blockSize: 400 }],
        contentBoxSize: [{ inlineSize: 600, blockSize: 400 }],
        devicePixelContentBoxSize: [],
      },
    ],
    {} as ResizeObserver
  );
  expect(frames.size).toBeGreaterThan(0);
  const target = f.element.querySelector<HTMLElement>('[data-index]');
  if (!target) throw new Error('Missing virtual row');
  expect(f.navigation()?.scrollToElement(target)).toBe(true);
  expect(frames.size).toBe(0);
});
