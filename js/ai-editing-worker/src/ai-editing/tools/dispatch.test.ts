import { describe, expect, it } from 'vitest';
import { computeContextRange, indexXmlRanges, mergeRanges } from './dispatch';

describe('mergeRanges', () => {
  it('leaves disjoint ranges alone', () => {
    expect(
      mergeRanges([
        [1, 3],
        [5, 7],
      ])
    ).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it('merges overlapping ranges', () => {
    expect(
      mergeRanges([
        [1, 5],
        [3, 8],
      ])
    ).toEqual([[1, 8]]);
  });

  it('merges adjacent ranges', () => {
    expect(
      mergeRanges([
        [1, 3],
        [4, 6],
      ])
    ).toEqual([[1, 6]]);
  });

  it('handles unsorted input', () => {
    expect(
      mergeRanges([
        [5, 7],
        [1, 3],
      ])
    ).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it('returns empty for empty input', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('indexXmlRanges', () => {
  it('indexes a single node', () => {
    const xml = '<p id="abc123">hello</p>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.get('abc123')).toMatchObject({
      tag: 'p',
      id: 'abc123',
      startLine: 1,
      endLine: 1,
    });
  });

  it('tracks start/end lines for a multiline node', () => {
    const xml = '<ul id="list01">\n<li id="item01">one</li>\n</ul>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.get('list01')).toMatchObject({ startLine: 1, endLine: 3 });
    expect(byId.get('item01')).toMatchObject({ startLine: 2, endLine: 2 });
  });

  it('records ancestors', () => {
    const xml = '<ul id="list01">\n<li id="item01">one</li>\n</ul>';
    const { byId } = indexXmlRanges(xml);
    const item = byId.get('item01')!;
    expect(item.ancestors.map((a) => a.id)).toEqual(['list01']);
  });

  it('ignores nodes without ids', () => {
    const xml = '<p>no id here</p>\n<p id="abc123">has id</p>';
    const { byId } = indexXmlRanges(xml);
    expect(byId.size).toBe(1);
    expect(byId.has('abc123')).toBe(true);
  });
});

describe('computeContextRange', () => {
  const xml =
    '<p id="abc123">first</p>\n<p id="def456">second</p>\n<p id="ghi789">third</p>';

  it('falls back to full document when no ids match', () => {
    const range = computeContextRange(xml, 'rewrite the intro');
    expect(range.source).toBe('full-document');
    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(3);
  });

  it('narrows to the matching node when an id is present', () => {
    const range = computeContextRange(xml, `edit node abc123`);
    expect(range.source).toBe('ids');
    expect(range.ids).toContain('abc123');
  });

  it('spans multiple matched nodes', () => {
    const range = computeContextRange(xml, `abc123 and ghi789`);
    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(3);
  });
});
