import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import {
  createRangeFromOffsets,
  getSearchHighlightRects,
} from './getSearchHighlightRects';

if (typeof document === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Range = dom.window.Range;
}

function mockRect(width: number, height = 16): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

describe('createRangeFromOffsets', () => {
  test('maps offsets onto nested chip text rather than the leading icon', () => {
    const chip = document.createElement('span');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.append('Fix the login bug');
    chip.append(icon, label);
    document.body.append(chip);

    const range = createRangeFromOffsets(chip, 8, 13);
    expect(range).not.toBeNull();
    expect(range?.startContainer).toBe(label.firstChild);
    expect(range?.startOffset).toBe(8);
    expect(range?.endContainer).toBe(label.firstChild);
    expect(range?.endOffset).toBe(13);
    expect(range?.toString()).toBe('login');
  });
});

describe('getSearchHighlightRects', () => {
  test('falls back to the chip bounds when highlightEntire is set', () => {
    const chip = document.createElement('span');
    chip.append('Fix the login bug');
    document.body.append(chip);

    const original = chip.getBoundingClientRect.bind(chip);
    chip.getBoundingClientRect = () => mockRect(120);

    const rects = getSearchHighlightRects(
      chip,
      { start: 8, end: 13, isReplace: true },
      true
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBe(120);

    chip.getBoundingClientRect = original;
  });

  test('falls back to the chip bounds when text offsets cannot be mapped', () => {
    const chip = document.createElement('span');
    const icon = document.createElement('span');
    chip.append(icon);
    document.body.append(chip);

    chip.getBoundingClientRect = () => mockRect(18);

    const rects = getSearchHighlightRects(chip, {
      start: 0,
      end: 5,
      isReplace: true,
    });
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBe(18);
  });
});
