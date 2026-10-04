import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockOf,
  blockSpanOfRange,
  changedTextEnd,
  contentOffset,
  contentRange,
  contentText,
} from './text-offsets';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="root">
      <p data-anchor="p1"><span data-list-marker="">1.</span><span>‎Hello </span><b>bold</b><span> world</span></p>
      <p data-anchor="p2">Page <span data-field="" data-field-cached="7">12</span> end</p>
    </div>`;
  root = document.getElementById('root')!;
});

const block = (id: string) =>
  root.querySelector<HTMLElement>(`[data-anchor="${id}"]`)!;

describe('content offsets', () => {
  it('excludes list markers and bidi marks from the text', () => {
    expect(contentText(block('p1'))).toBe('Hello bold world');
  });

  it('counts a field as its cached result', () => {
    expect(contentText(block('p2'))).toBe('Page 7 end');
  });

  it('maps DOM positions to content offsets', () => {
    const bold = block('p1').querySelector('b')!.firstChild!;
    expect(contentOffset(block('p1'), bold, 2)).toBe(8);
  });

  it('builds ranges that cover exactly the requested text', () => {
    const range = contentRange(block('p1'), 6, 7)!;
    expect(range.toString()).toBe('bold wo');
    expect(contentRange(block('p1'), 0, 5)!.toString()).toBe('Hello');
    expect(contentRange(block('p1'), 40, 2)).toBeNull();
  });

  it('round-trips a selection into a block span', () => {
    const range = contentRange(block('p1'), 6, 4)!;
    expect(blockSpanOfRange(range, root)).toMatchObject({
      block: block('p1'),
      start: 6,
      length: 4,
    });
  });

  it('clamps a selection that continues into the next block', () => {
    const range = document.createRange();
    const start = contentRange(block('p1'), 11, 1)!;
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(block('p2').firstChild!, 2);
    expect(blockSpanOfRange(range, root)).toMatchObject({
      start: 11,
      length: 5,
    });
  });

  it('finds the block that owns a node', () => {
    expect(blockOf(block('p2').firstChild, root)).toBe(block('p2'));
    expect(blockOf(root, root)).toBeNull();
  });
});

describe('changed text end', () => {
  it('lands after reinserted text and where removed text was', () => {
    expect(changedTextEnd('notice.', 'notice. More.')).toBe(13);
    expect(changedTextEnd('notice. More.', 'notice.')).toBe(7);
  });

  it('handles a change in the middle and repeated characters', () => {
    expect(changedTextEnd('abcdef', 'abcXYZdef')).toBe(6);
    expect(changedTextEnd('aaa', 'aaaa')).toBe(4);
    expect(changedTextEnd('same', 'same')).toBe(4);
  });
});
