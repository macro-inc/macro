/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPager,
  Pager,
  type PagerController,
  PagerSwipeGestures,
} from '.';

type PageId = 'previous' | 'current' | 'next';

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
  const rail = container.querySelector<HTMLElement>('.pager-rail');
  if (!rail) throw new Error('Pager rail was not rendered');
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  rail.dispatchEvent(event);
}

function renderSwipePager() {
  let controller!: PagerController<PageId>;
  const pages: PageId[] = ['previous', 'current', 'next'];
  const [activePage, setActivePage] = createSignal<PageId>('current');

  const rendered = render(() => {
    controller = createPager({
      pageOrder: () => pages,
      activePage,
      onPageChange: (page) => setActivePage(page),
    });

    return (
      <Pager.Root controller={controller}>
        <Pager.Viewport>
          <For each={pages}>
            {(page) => <Pager.Page id={page}>{page}</Pager.Page>}
          </For>
        </Pager.Viewport>
        <PagerSwipeGestures />
      </Pager.Root>
    );
  });

  const viewport = rendered.container.querySelector<HTMLElement>('.pager');
  if (!viewport) throw new Error('Pager viewport was not rendered');
  Object.defineProperty(viewport, 'clientWidth', {
    configurable: true,
    value: 320,
  });

  return { ...rendered, activePage, controller, viewport };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe('PagerSwipeGestures', () => {
  it('commits a horizontal touch gesture after crossing the threshold', () => {
    const rendered = renderSwipePager();
    fireEvent(
      rendered.viewport,
      touchEvent('touchstart', [{ clientX: 200, clientY: 100 }], 0)
    );
    const move = touchEvent('touchmove', [{ clientX: 100, clientY: 102 }], 30);
    fireEvent(rendered.viewport, move);
    fireEvent(
      rendered.viewport,
      touchEvent('touchend', [], 60, [{ clientX: 100, clientY: 102 }])
    );

    expect(move.defaultPrevented).toBe(true);
    expect(rendered.controller.targetPage()).toBe('next');
    finishTransition(rendered.container);
    expect(rendered.activePage()).toBe('next');
  });

  it('snaps back when a second touch interrupts the gesture', () => {
    const rendered = renderSwipePager();
    fireEvent(
      rendered.viewport,
      touchEvent('touchstart', [{ clientX: 200, clientY: 100 }], 0)
    );
    fireEvent(
      rendered.viewport,
      touchEvent('touchmove', [{ clientX: 150, clientY: 100 }], 20)
    );
    expect(rendered.controller.phase()).toBe('dragging');

    fireEvent(
      rendered.viewport,
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
    expect(rendered.activePage()).toBe('current');
  });

  it('leaves vertical touch movement available to the browser', () => {
    const rendered = renderSwipePager();
    fireEvent(
      rendered.viewport,
      touchEvent('touchstart', [{ clientX: 100, clientY: 100 }], 0)
    );
    const move = touchEvent('touchmove', [{ clientX: 102, clientY: 140 }], 20);
    fireEvent(rendered.viewport, move);

    expect(move.defaultPrevented).toBe(false);
    expect(rendered.controller.phase()).toBe('idle');
  });
});
