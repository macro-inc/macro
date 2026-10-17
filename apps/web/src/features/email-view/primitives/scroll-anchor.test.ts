import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createScrollAnchor } from './scroll-anchor';

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A scroller whose rows sit at fixed offsets in the content, like the
 * virtualizer's absolutely positioned rows; jsdom has no layout, so each row
 * reports its offset minus the scroll position.
 */
function list(ids: string[]) {
  const scroller = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  const layout = (next: string[]) => {
    scroller.replaceChildren(
      ...next.map((id, index) => {
        const row = document.createElement('div');
        row.id = id;
        row.setAttribute('role', 'row');
        row.getBoundingClientRect = () =>
          ({ top: index * 44 - scrollTop }) as DOMRect;
        return row;
      })
    );
  };
  layout(ids);
  document.body.append(scroller);
  return {
    scroller,
    layout,
    scrollTo: (value: number) => {
      scrollTop = value;
    },
  };
}

function setup(ids: string[]) {
  const dom = list(ids);
  const [rows, setRows] = createSignal(ids.map((id) => ({ id })));
  const anchor = createRoot(() =>
    createScrollAnchor({ scroller: () => dom.scroller, rows })
  );
  const update = (next: string[]) => {
    dom.layout(next);
    setRows(next.map((id) => ({ id })));
  };
  return { dom, anchor, update };
}

it('keeps the rows on screen still when mail arrives above them', () => {
  const ids = Array.from({ length: 20 }, (_, index) => `row-${index}`);
  const { dom, anchor, update } = setup(ids);
  dom.scrollTo(440);
  anchor.capture();

  update(['header', 'new-mail', ...ids]);

  // row-10 was at the top of the viewport and still is.
  expect(dom.scroller.scrollTop).toBe(440 + 88);
});

it('keeps the anchor through the removal of the row it was on', () => {
  const ids = Array.from({ length: 20 }, (_, index) => `row-${index}`);
  const { dom, anchor, update } = setup(ids);
  dom.scrollTo(440);
  anchor.capture();

  update(['new-mail', ...ids.filter((id) => id !== 'row-10')]);

  // row-11 stays where it was; nothing jumps.
  expect(dom.scroller.scrollTop).toBe(440);
});

it('leaves the list at the top so new mail shows there', () => {
  const ids = Array.from({ length: 20 }, (_, index) => `row-${index}`);
  const { dom, anchor, update } = setup(ids);
  anchor.capture();

  update(['new-mail', ...ids]);

  expect(dom.scroller.scrollTop).toBe(0);
});
