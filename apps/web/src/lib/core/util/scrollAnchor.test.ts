/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureElementScrollAnchor,
  captureScrollAnchor,
  holdScrollAnchor,
  restoreScrollAnchor,
} from './scrollAnchor';

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'caretRangeFromPoint');
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
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

  it('anchors text at the viewport top inside a block that starts above it', () => {
    const { scroller, root, blocks } = setup([-300, 400]);
    vi.spyOn(blocks[0]!, 'getBoundingClientRect').mockReturnValue(
      rect(-300, 300)
    );
    const text = blocks[0]!.firstChild!;
    let caretTop = 5;
    // jsdom has no layout, so caret hit-testing and Range rects are stubbed.
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(text, 3);
      return range;
    };
    Range.prototype.getClientRects = function (this: Range) {
      return (this.startContainer === text
        ? [rect(caretTop, caretTop + 20)]
        : []) as unknown as DOMRectList;
    };
    scroller.scrollTop = 1000;

    const anchor = captureScrollAnchor(scroller, root);
    expect(anchor?.top).toBe(5);

    // The block rewraps taller while its own top stays put.
    caretTop = 85;
    restoreScrollAnchor(scroller, anchor!);
    expect(scroller.scrollTop).toBe(1080);
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

function setupScrolledElement(top: number) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  const content = document.createElement('div');
  const element = document.createElement('span');
  content.append(element);
  scroller.append(content);
  document.body.append(scroller);
  // jsdom has no layout, so the scroll extent and rects are stubbed.
  Object.defineProperty(scroller, 'scrollHeight', {
    value: 5000,
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', { value: 500 });
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0, 500));
  const position = { top };
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() =>
    rect(position.top, position.top + 20)
  );
  scroller.scrollTop = 1000;
  return { scroller, element, position };
}

function stubResizeObserver() {
  const callbacks = new Set<ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {
        callbacks.add(callback);
      }
      observe() {}
      disconnect() {
        callbacks.delete(this.callback);
      }
    }
  );
  const notify = () => {
    for (const callback of callbacks) {
      callback([], {} as ResizeObserver);
    }
  };
  return { notify, isObserving: () => callbacks.size > 0 };
}

describe('element scroll anchor', () => {
  it('anchors an element that is on screen in its scroll container', () => {
    const { scroller, position, element } = setupScrolledElement(450);

    const captured = captureElementScrollAnchor(element);
    expect(captured?.scroller).toBe(scroller);
    expect(captured?.anchor.top).toBe(450);

    position.top = 700;
    restoreScrollAnchor(scroller, captured!.anchor);
    expect(scroller.scrollTop).toBe(1250);
  });

  it('ignores an element scrolled out of view', () => {
    const { element } = setupScrolledElement(620);

    expect(captureElementScrollAnchor(element)).toBeUndefined();
  });

  it('ignores an element without a scroll container', () => {
    const element = document.createElement('span');
    document.body.append(element);

    expect(captureElementScrollAnchor(element)).toBeUndefined();
  });

  it('anchors a tall element that starts above the viewport', () => {
    const { scroller, element } = setupScrolledElement(-200);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(-200, 300));

    const captured = captureElementScrollAnchor(element);
    expect(captured?.scroller).toBe(scroller);
    expect(captured?.anchor.top).toBe(-200);
  });

  it('skips an inner scroll container that does not overflow', () => {
    const { scroller, element } = setupScrolledElement(450);
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    element.replaceWith(inner);
    inner.append(element);

    expect(captureElementScrollAnchor(element)?.scroller).toBe(scroller);
  });

  it('falls back to a scroll container whose content still fits', () => {
    const { scroller, element } = setupScrolledElement(450);
    Object.defineProperty(scroller, 'scrollHeight', { value: 500 });

    expect(captureElementScrollAnchor(element)?.scroller).toBe(scroller);
  });

  it('holds the element in place through later reflows', () => {
    vi.useFakeTimers();
    const resize = stubResizeObserver();
    const { scroller, position, element } = setupScrolledElement(450);
    const { anchor } = captureElementScrollAnchor(element)!;

    position.top = 700;
    holdScrollAnchor(scroller, anchor);
    expect(scroller.scrollTop).toBe(1250);
    expect(scroller.style.overflowAnchor).toBe('none');

    // A component re-lays out after the width change and reflows again.
    position.top = 600;
    resize.notify();
    expect(scroller.scrollTop).toBe(1400);

    vi.advanceTimersByTime(1000);
    expect(resize.isObserving()).toBe(false);
    expect(scroller.style.overflowAnchor).toBe('');
  });

  it('lets the user scroll away during the hold', () => {
    vi.useFakeTimers();
    const resize = stubResizeObserver();
    const { scroller, position, element } = setupScrolledElement(450);
    const { anchor } = captureElementScrollAnchor(element)!;

    holdScrollAnchor(scroller, anchor);
    scroller.dispatchEvent(new WheelEvent('wheel'));

    position.top = 700;
    resize.notify();
    expect(scroller.scrollTop).toBe(1000);
    expect(resize.isObserving()).toBe(false);
  });

  it('restores native scroll anchoring after back-to-back holds', () => {
    vi.useFakeTimers();
    stubResizeObserver();
    const { scroller, element } = setupScrolledElement(450);
    scroller.style.overflowAnchor = 'auto';

    holdScrollAnchor(scroller, captureElementScrollAnchor(element)!.anchor);
    vi.advanceTimersByTime(500);
    holdScrollAnchor(scroller, captureElementScrollAnchor(element)!.anchor);
    vi.advanceTimersByTime(1000);

    expect(scroller.style.overflowAnchor).toBe('auto');
  });
});
