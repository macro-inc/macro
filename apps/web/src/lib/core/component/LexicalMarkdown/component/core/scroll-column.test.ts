import type { MiddlewareState } from '@floating-ui/dom';
import { describe, expect, it } from 'vitest';
import { previewCardMiddleware, scrollColumn } from './scroll-column';

function box(style: string, className = '') {
  const element = document.createElement('div');
  element.setAttribute('style', style);
  if (className) element.className = className;
  return element;
}

describe('scrollColumn', () => {
  // A browser computes overflow-y to auto for overflow-x: auto; jsdom does
  // not, so the boxes inside the markdown set it explicitly.
  it("skips static markdown's own scrolling boxes and finds the column", () => {
    const column = box('overflow-y: auto');
    const root = box('overflow-x: auto; overflow-y: auto', 'markdown-content');
    const table = box('overflow-x: auto; overflow-y: auto');
    const link = document.createElement('a');
    table.append(link);
    root.append(table);
    column.append(root);
    document.body.append(column);
    expect(scrollColumn(link)).toBe(column);
    column.remove();
  });

  it('starts above the outermost markdown root when markdown nests', () => {
    const column = box('overflow-y: auto');
    const outer = box('', 'markdown-content');
    const between = box('overflow-y: auto');
    const inner = box('');
    inner.setAttribute('data-lexical-editor', 'true');
    const link = document.createElement('a');
    inner.append(link);
    between.append(inner);
    outer.append(between);
    column.append(outer);
    document.body.append(column);
    expect(scrollColumn(link)).toBe(column);
    column.remove();
  });

  it('finds nothing when no ancestor scrolls', () => {
    const root = box('', 'markdown-content');
    const link = document.createElement('a');
    root.append(link);
    document.body.append(root);
    expect(scrollColumn(link)).toBeUndefined();
    root.remove();
  });

  it("bounds the card by the link's column, found when it is positioned", () => {
    // Built before the link exists, as the card's options are.
    const middleware = previewCardMiddleware(4);
    const column = box('overflow-y: auto');
    const root = box('', 'markdown-content');
    const link = document.createElement('a');
    root.append(link);
    column.append(root);
    document.body.append(column);
    const state = {
      elements: { reference: link, floating: document.createElement('div') },
    } as unknown as MiddlewareState;
    for (const name of ['flip', 'shift']) {
      const options = middleware.find((step) => step.name === name)?.options;
      const resolved = typeof options === 'function' ? options(state) : options;
      expect(resolved.boundary).toBe(column);
    }
    column.remove();
  });
});
