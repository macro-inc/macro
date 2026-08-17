/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPager, Pager, type PagerController, usePager } from '.';

type PageId = 'a' | 'b' | 'c' | 'd';

function finishTransition(container: HTMLElement) {
  const rail = container.querySelector<HTMLElement>('.pager-rail');
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
  let controller!: PagerController<PageId>;
  let contextController!: PagerController<PageId>;
  const pages = options?.pages ?? ['a', 'b', 'c'];
  const [pageOrder, setPageOrder] = createSignal<readonly PageId[]>(pages);
  const [activePage, setActivePage] = createSignal<PageId>(pages[1] ?? 'a');

  function Controls() {
    contextController = usePager<PageId>();
    return null;
  }

  const rendered = render(() => {
    controller = createPager({
      pageOrder,
      activePage,
      canChangePage: ({ to }) => options?.canChangePage?.(to) ?? true,
      onPageChange: (page) => {
        setActivePage(page);
        options?.onChange?.(page);
      },
    });

    return (
      <Pager.Root controller={controller}>
        <Controls />
        <Pager.Viewport>
          <For each={pages}>
            {(page) => <Pager.Page id={page}>{page}</Pager.Page>}
          </For>
        </Pager.Viewport>
      </Pager.Root>
    );
  });

  const viewport = rendered.container.querySelector<HTMLElement>('.pager');
  if (!viewport) throw new Error('Pager viewport was not rendered');
  Object.defineProperty(viewport, 'clientWidth', {
    configurable: true,
    value: 320,
  });

  return {
    ...rendered,
    activePage,
    contextController,
    controller,
    pageOrder,
    setPageOrder,
  };
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

describe('Pager', () => {
  it('provides its controller outside the viewport', () => {
    const rendered = renderPager();
    expect(rendered.contextController).toBe(rendered.controller);
  });

  it('animates to the next page and commits after transition end', async () => {
    const onChange = vi.fn();
    const rendered = renderPager({ onChange });

    const navigation = rendered.contextController.next();
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

  it('finishes rapid arrow navigation without replaying the full animation', async () => {
    const rendered = renderPager({ pages: ['a', 'b', 'c', 'd'] });

    const firstNavigation = rendered.controller.next();
    const secondNavigation = rendered.controller.next();

    await expect(firstNavigation).resolves.toBe(true);
    await expect(secondNavigation).resolves.toBe(true);
    expect(rendered.activePage()).toBe('d');
    expect(rendered.controller.phase()).toBe('idle');
  });

  it('keeps repeated clicks immediate for longer than one animation', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const rendered = renderPager({ pages: ['a', 'b', 'c', 'd'] });

    const firstNavigation = rendered.controller.next();
    finishTransition(rendered.container);
    await firstNavigation;

    now.mockReturnValue(1_400);
    await expect(rendered.controller.next()).resolves.toBe(true);
    expect(rendered.activePage()).toBe('d');
    expect(rendered.controller.phase()).toBe('idle');

    now.mockRestore();
  });

  it('supports rapid navigation while the consumer rotates a three-page buffer', async () => {
    let rendered!: ReturnType<typeof renderPager>;
    rendered = renderPager({
      onChange: () => {
        const [first, ...remaining] = rendered.pageOrder();
        rendered.setPageOrder([...remaining, first]);
      },
    });

    const firstNavigation = rendered.controller.next();
    const secondNavigation = rendered.controller.next();

    await expect(firstNavigation).resolves.toBe(true);
    await expect(secondNavigation).resolves.toBe(true);
    expect(rendered.activePage()).toBe('a');
    expect(rendered.pageOrder()).toEqual(['c', 'a', 'b']);
    expect(rendered.controller.relativePosition('a')).toBe(0);
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

  it('supports externally controlled drag progress', async () => {
    const rendered = renderPager();

    expect(rendered.controller.beginDrag()).toBe(true);
    rendered.controller.updateDrag(-100);
    const navigation = rendered.controller.commitDrag('next');
    finishTransition(rendered.container);

    await expect(navigation).resolves.toBe(true);
    expect(rendered.activePage()).toBe('c');
  });

  it('resets synchronously when the viewport detaches', async () => {
    const rendered = renderPager();
    const navigation = rendered.controller.next();
    expect(rendered.controller.phase()).toBe('settling');

    rendered.unmount();

    expect(rendered.controller.phase()).toBe('idle');
    await expect(navigation).resolves.toBe(false);
  });
});
