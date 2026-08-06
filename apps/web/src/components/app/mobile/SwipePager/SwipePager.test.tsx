/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSwipePager,
  type SwipePagerController,
  SwipePagerPage,
  SwipePagerRoot,
} from './SwipePager';

type PageId = 'a' | 'b' | 'c' | 'd';

function touchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
  timeStamp: number,
  changedTouches = touches
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    changedTouches: { value: changedTouches },
    timeStamp: { value: timeStamp },
    touches: { value: touches },
  });
  return event;
}

function finishTransition(container: HTMLElement) {
  const rail = container.querySelector<HTMLElement>('.swipe-pager-rail');
  if (!rail) throw new Error('Pager rail was not rendered');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  rail.dispatchEvent(event);
}

function renderPager(options?: {
  canChangePage?: (page: PageId) => boolean;
  onChange?: (page: PageId) => void;
  pages?: PageId[];
}) {
  let controller!: SwipePagerController<PageId>;
  const pages = options?.pages ?? ['a', 'b', 'c'];
  const [pageOrder, setPageOrder] = createSignal<readonly PageId[]>(pages);
  const [activePage, setActivePage] = createSignal<PageId>(pages[1] ?? 'a');

  const rendered = render(() => {
    controller = createSwipePager({
      pageOrder,
      activePage,
      canChangePage: ({ to }) => options?.canChangePage?.(to) ?? true,
      onPageChange: (page) => {
        setActivePage(page);
        options?.onChange?.(page);
      },
    });

    return (
      <SwipePagerRoot controller={controller}>
        <For each={pages}>
          {(page) => (
            <SwipePagerPage controller={controller} id={page}>
              {page}
            </SwipePagerPage>
          )}
        </For>
      </SwipePagerRoot>
    );
  });

  const viewport =
    rendered.container.querySelector<HTMLElement>('.swipe-pager');
  if (!viewport) throw new Error('Pager viewport was not rendered');
  Object.defineProperty(viewport, 'clientWidth', {
    configurable: true,
    value: 320,
  });

  return {
    ...rendered,
    activePage,
    controller,
    pageOrder,
    setActivePage,
    setPageOrder,
  };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

describe('SwipePager', () => {
  it('animates to the next page and commits after transition end', async () => {
    const onChange = vi.fn();
    const rendered = renderPager({ onChange });

    const navigation = rendered.controller.next();
    expect(rendered.controller.phase()).toBe('settling');
    expect(rendered.controller.targetPage()).toBe('c');
    expect(rendered.activePage()).toBe('b');

    finishTransition(rendered.container);

    await expect(navigation).resolves.toBe(true);
    expect(rendered.activePage()).toBe('c');
    expect(rendered.controller.phase()).toBe('idle');
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('supports any number of ordered pages', async () => {
    const rendered = renderPager({ pages: ['a', 'b', 'c', 'd'] });

    const navigation = rendered.controller.goTo('d');
    finishTransition(rendered.container);

    await expect(navigation).resolves.toBe(true);
    expect(rendered.activePage()).toBe('d');
    expect(rendered.controller.relativePosition('a')).toBe(-3);
  });

  it('leaves page reordering to the controlled consumer', async () => {
    let rendered!: ReturnType<typeof renderPager>;
    rendered = renderPager({
      onChange: (page) => {
        if (page === 'c') rendered.setPageOrder(['b', 'c', 'a']);
      },
    });

    const navigation = rendered.controller.next();
    finishTransition(rendered.container);

    await navigation;
    expect(rendered.activePage()).toBe('c');
    expect(rendered.pageOrder()).toEqual(['b', 'c', 'a']);
    expect(rendered.controller.relativePosition('b')).toBe(-1);
    expect(rendered.controller.relativePosition('a')).toBe(1);
  });

  it('does not start a disabled transition', async () => {
    const rendered = renderPager({
      canChangePage: (page) => page !== 'c',
    });

    await expect(rendered.controller.next()).resolves.toBe(false);
    expect(rendered.controller.phase()).toBe('idle');
    expect(rendered.activePage()).toBe('b');
  });

  it('commits a horizontal touch gesture after crossing the threshold', async () => {
    const rendered = renderPager();
    const viewport = rendered.container.querySelector('.swipe-pager')!;
    fireEvent(
      viewport,
      touchEvent('touchstart', [{ clientX: 200, clientY: 100 }], 0)
    );
    const move = touchEvent('touchmove', [{ clientX: 100, clientY: 102 }], 30);
    fireEvent(viewport, move);
    fireEvent(
      viewport,
      touchEvent('touchend', [], 60, [{ clientX: 100, clientY: 102 }])
    );

    expect(move.defaultPrevented).toBe(true);
    expect(rendered.controller.targetPage()).toBe('c');
    finishTransition(rendered.container);
    expect(rendered.activePage()).toBe('c');
  });

  it('snaps back and unlocks navigation when a second touch interrupts', () => {
    const rendered = renderPager();
    const viewport = rendered.container.querySelector('.swipe-pager')!;
    fireEvent(
      viewport,
      touchEvent('touchstart', [{ clientX: 200, clientY: 100 }], 0)
    );
    fireEvent(
      viewport,
      touchEvent('touchmove', [{ clientX: 150, clientY: 100 }], 20)
    );
    expect(rendered.controller.phase()).toBe('dragging');

    fireEvent(
      viewport,
      touchEvent(
        'touchstart',
        [
          { clientX: 150, clientY: 100 },
          { clientX: 170, clientY: 100 },
        ],
        30
      )
    );
    expect(rendered.controller.phase()).toBe('settling');

    finishTransition(rendered.container);
    expect(rendered.controller.phase()).toBe('idle');
    expect(rendered.activePage()).toBe('b');
  });

  it('resets synchronously when detached during a transition', async () => {
    const rendered = renderPager();
    const navigation = rendered.controller.next();
    expect(rendered.controller.phase()).toBe('settling');

    rendered.unmount();

    expect(rendered.controller.phase()).toBe('idle');
    await expect(navigation).resolves.toBe(false);
  });

  it('keeps vertical touch movement available to the browser', () => {
    const rendered = renderPager();
    const viewport = rendered.container.querySelector('.swipe-pager')!;
    fireEvent(
      viewport,
      touchEvent('touchstart', [{ clientX: 100, clientY: 100 }], 0)
    );
    const move = touchEvent('touchmove', [{ clientX: 102, clientY: 140 }], 20);
    fireEvent(viewport, move);

    expect(move.defaultPrevented).toBe(false);
    expect(rendered.controller.phase()).toBe('idle');
  });
});
