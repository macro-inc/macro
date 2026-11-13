import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListNavigation } from '../ThreadList';

vi.mock('@solid-primitives/platform', () => ({
  isSafari: false,
  isIOS: false,
}));
vi.mock('@core/component/CustomScrollbar', () => ({
  CustomScrollbar: () => null,
}));

const rowHeights = new Map<string, number>();
const observed = new Set<Element>();
let resize: ResizeObserverCallback | undefined;

beforeEach(() => {
  rowHeights.clear();
  observed.clear();
  // Supply layout for the real virtualizer; jsdom does not measure DOM nodes.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (!this.hasAttribute('data-index')) return 400;
      const key = this.querySelector<HTMLElement>('[data-row]')?.dataset.row;
      return rowHeights.get(key ?? '') ?? 96;
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
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(target: Element) {
        observed.add(target);
      }
      unobserve(target: Element) {
        observed.delete(target);
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

const keys = Array.from({ length: 20 }, (_, index) => String(index));

function setup(holdOnDisclosure: boolean) {
  let navigation: ThreadListNavigation | undefined;
  const { container } = render(() => (
    <ThreadList
      keys={() => keys}
      holdOnDisclosure={holdOnDisclosure}
      onReady={(value) => {
        navigation = value;
      }}
    >
      {({ id }) => (
        <div data-row={id}>
          <button type="button" aria-expanded="false">
            Called 2 tools
          </button>
          <button type="button">Copy</button>
        </div>
      )}
    </ThreadList>
  ));
  const element = container.querySelector<HTMLDivElement>(
    '[data-channel-scroll]'
  )!;
  const row = (key: string) =>
    container.querySelector<HTMLElement>(`[data-row="${key}"]`)!;
  // A streaming reply grows the last row; the browser reports its new height.
  const grow = (key: string, height: number) => {
    rowHeights.set(key, height);
    const target: Element = row(key).parentElement!;
    expect(observed.has(target)).toBe(true);
    resize?.([{ target } as ResizeObserverEntry], {} as ResizeObserver);
  };
  return { element, row, grow, navigation: () => navigation };
}

const settle = () =>
  new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

describe('holding the reading position on a disclosure press', () => {
  it('follows a growing last row while pinned to the end', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());
    expect(list.element.scrollTop).toBe(20 * 96 - 400);

    list.grow('19', 300);
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 300 - 400)
    );
  });

  it('keeps a pressed tool group under the pointer while the row grows', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());
    const pinned = list.element.scrollTop;

    list
      .row('19')
      .querySelector('[aria-expanded]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    list.grow('19', 300);
    await waitFor(() => expect(list.element.scrollHeight).toBe(19 * 96 + 300));
    await settle();
    expect(list.element.scrollTop).toBe(pinned);
  });

  it('holds for a keyboard toggle too', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());
    const pinned = list.element.scrollTop;

    list
      .row('19')
      .querySelector('[aria-expanded]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    list.grow('19', 300);
    await waitFor(() => expect(list.element.scrollHeight).toBe(19 * 96 + 300));
    await settle();
    expect(list.element.scrollTop).toBe(pinned);
  });

  it('keeps following after a press on a control that opens nothing', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());

    list
      .row('19')
      .querySelector('button:not([aria-expanded])')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    list.grow('19', 300);
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 300 - 400)
    );
  });

  it('resumes following once the reader scrolls back down to the end', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());
    list
      .row('19')
      .querySelector('[aria-expanded]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    list.grow('19', 300);
    await waitFor(() => expect(list.element.scrollHeight).toBe(19 * 96 + 300));

    list.element.scrollTop = 19 * 96 + 300 - 400;
    list.element.dispatchEvent(new Event('scroll'));
    await settle();
    list.grow('19', 500);
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 500 - 400)
    );
  });

  it('resumes following when the reader jumps to the latest message', async () => {
    const list = setup(true);
    await waitFor(() => expect(list.navigation()).toBeDefined());
    list
      .row('19')
      .querySelector('[aria-expanded]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    list.grow('19', 300);
    await waitFor(() => expect(list.element.scrollHeight).toBe(19 * 96 + 300));

    list.navigation()?.scrollToLatest();
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 300 - 400)
    );
    list.grow('19', 500);
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 500 - 400)
    );
  });

  it('keeps following a disclosure press in lists that do not opt in', async () => {
    const list = setup(false);
    await waitFor(() => expect(list.navigation()).toBeDefined());

    list
      .row('19')
      .querySelector('[aria-expanded]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    list.grow('19', 300);
    await waitFor(() =>
      expect(list.element.scrollTop).toBe(19 * 96 + 300 - 400)
    );
  });
});
