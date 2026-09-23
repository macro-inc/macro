/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureScrollAnchor, restoreScrollAnchor } from './scrollAnchor';

const rect = (top: number, bottom: number) =>
  ({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
  }) as DOMRect;

function setup(blockTops: number[]) {
  const scroller = document.createElement('div');
  const root = document.createElement('div');
  scroller.append(root);
  document.body.append(scroller);
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
  const tops = [...blockTops];
  const blocks = tops.map((_, i) => {
    const block = document.createElement('p');
    block.textContent = `block ${i}`;
    vi.spyOn(block, 'getBoundingClientRect').mockImplementation(() =>
      rect(tops[i]!, tops[i]! + 100)
    );
    root.append(block);
    return block;
  });
  return { scroller, root, blocks, tops };
}

afterEach(() => {
  document.body.replaceChildren();
  getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('scroll anchor', () => {
  it('keeps the first visible block in place when the document reflows', () => {
    const { scroller, root, tops } = setup([-250, -150, -50, 50]);
    scroller.scrollTop = 1000;

    const anchor = captureScrollAnchor(scroller, root);
    expect(anchor?.top).toBe(-50);

    tops[2] = 250;
    restoreScrollAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(1300);
  });

  it('prefers the on-screen selection over the first visible block', () => {
    const { scroller, root, blocks } = setup([0, 100, 200, 300]);
    let selectionTop = 320;
    const range = document.createRange();
    range.selectNodeContents(blocks[3]!);
    // jsdom has no layout, so Range lacks getClientRects.
    range.getClientRects = () =>
      [rect(selectionTop, selectionTop + 20)] as unknown as DOMRectList;
    getSelection()?.addRange(range);
    scroller.scrollTop = 1000;

    const anchor = captureScrollAnchor(scroller, root);
    expect(anchor?.top).toBe(320);

    selectionTop = 1120;
    restoreScrollAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(1800);
  });

  it('ignores a selection outside the editor', () => {
    const { scroller, root } = setup([0, 100]);
    const outside = document.createElement('input');
    document.body.append(outside);
    const range = document.createRange();
    range.selectNode(outside);
    getSelection()?.addRange(range);

    expect(captureScrollAnchor(scroller, root)?.top).toBe(0);
  });
});
