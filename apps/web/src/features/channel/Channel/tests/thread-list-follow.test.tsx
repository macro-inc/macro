import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
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

beforeEach(() => {
  rowHeights.clear();
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

describe('following messages that arrive while pinned to the end', () => {
  it('stays at the end when two messages arrive before either is measured', async () => {
    const [keys, setKeys] = createSignal(
      Array.from({ length: 20 }, (_, index) => String(index))
    );
    let navigation: ThreadListNavigation | undefined;
    const { container } = render(() => (
      <ThreadList
        keys={keys}
        onReady={(value) => {
          navigation = value;
        }}
      >
        {({ id }) => <div data-row={id}>Message {id}</div>}
      </ThreadList>
    ));
    const element = container.querySelector<HTMLDivElement>(
      '[data-channel-scroll]'
    )!;
    await waitFor(() => expect(navigation).toBeDefined());
    expect(element.scrollTop).toBe(20 * 96 - 400);

    // Two long messages arrive back to back, taller than their estimate.
    rowHeights.set('20', 300);
    rowHeights.set('21', 300);
    setKeys((current) => [...current, '20']);
    setKeys((current) => [...current, '21']);

    await waitFor(() =>
      expect(element.scrollTop).toBe(20 * 96 + 300 + 300 - 400)
    );
  });

  it('does not follow the second message once the reader holds a disclosure', async () => {
    // Animation frames run on demand, so the virtualizer's scroll
    // reconciliation can be stepped after the rows are measured.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const [keys, setKeys] = createSignal(
      Array.from({ length: 20 }, (_, index) => String(index))
    );
    let navigation: ThreadListNavigation | undefined;
    const { container } = render(() => (
      <ThreadList
        keys={keys}
        holdOnDisclosure
        onReady={(value) => {
          navigation = value;
        }}
      >
        {({ id }) => (
          <div data-row={id}>
            <button type="button" aria-expanded="false">
              Called 2 tools
            </button>
          </div>
        )}
      </ThreadList>
    ));
    const element = container.querySelector<HTMLDivElement>(
      '[data-channel-scroll]'
    )!;
    await waitFor(() => expect(navigation).toBeDefined());

    rowHeights.set('20', 300);
    rowHeights.set('21', 300);
    setKeys((current) => [...current, '20']);
    container
      .querySelector('[data-row="19"] [aria-expanded]')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    const held = element.scrollTop;
    setKeys((current) => [...current, '21']);

    await waitFor(() => expect(element.scrollHeight).toBe(20 * 96 + 300 + 300));
    for (let frame = 0; frame < 5; frame++) {
      for (const callback of frames.splice(0)) callback(performance.now());
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    }
    expect(element.scrollTop).toBe(held);
  });
});
