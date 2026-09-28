import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListNavigation } from '../ThreadList';

const rowHeights = new Map<string, number>();

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
  // Supply layout for the real virtualizer; jsdom does not measure DOM nodes.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute('data-index')
        ? (rowHeights.get(this.textContent ?? '') ?? 96)
        : 400;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
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
      observe() {}
      unobserve() {}
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

function setup(followOnAppend = true) {
  const [keys, setKeys] = createSignal(
    Array.from({ length: 20 }, (_, index) => String(index))
  );
  const paginate = vi.fn();
  let navigation: ThreadListNavigation | undefined;
  const { container } = render(() => (
    <ThreadList
      keys={keys}
      followOnAppend={followOnAppend}
      onReady={(value) => {
        navigation = value;
      }}
      onScrollNearTop={paginate}
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
  return { element, paginate, prepend, setKeys, navigation: () => navigation };
}

describe('history loading ahead of scrolling', () => {
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
