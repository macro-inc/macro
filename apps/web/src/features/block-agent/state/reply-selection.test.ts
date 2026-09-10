import { describe, expect, it } from 'vitest';
import { normalizeReplySelection, selectionIsInside } from './reply-selection';

describe('normalizeReplySelection', () => {
  it('trims whitespace and nbsp', () => {
    expect(normalizeReplySelection('  hello world  ')).toBe('hello world');
    expect(normalizeReplySelection('\u00a0quoted\u00a0')).toBe('quoted');
  });

  it('rejects whitespace-only selections', () => {
    expect(normalizeReplySelection('   \n\t  ')).toBeUndefined();
    expect(normalizeReplySelection('\u00a0')).toBeUndefined();
    expect(normalizeReplySelection('')).toBeUndefined();
  });
});

describe('selectionIsInside', () => {
  it('requires the common ancestor to live in the container', () => {
    const container = document.createElement('div');
    const outside = document.createElement('div');
    const inside = document.createElement('span');
    inside.textContent = 'quoted';
    container.append(inside);
    document.body.append(container, outside);

    const inRange = document.createRange();
    inRange.selectNodeContents(inside);
    expect(selectionIsInside(container, inRange)).toBe(true);

    outside.textContent = 'nope';
    const outRange = document.createRange();
    outRange.selectNodeContents(outside);
    expect(selectionIsInside(container, outRange)).toBe(false);

    container.remove();
    outside.remove();
  });
});
