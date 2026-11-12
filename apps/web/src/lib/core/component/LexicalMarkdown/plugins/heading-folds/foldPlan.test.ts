import { describe, expect, it } from 'vitest';
import { computeFoldPlan, enclosingHeadings, type FoldBlock } from './foldPlan';

// # A / p1 / ## B / p2 / ### C / p3 / ## D / p4 / # E / p5
const DOC: FoldBlock[] = [
  { key: 'A', level: 1 },
  { key: 'p1', level: null },
  { key: 'B', level: 2 },
  { key: 'p2', level: null },
  { key: 'C', level: 3 },
  { key: 'p3', level: null },
  { key: 'D', level: 2 },
  { key: 'p4', level: null },
  { key: 'E', level: 1 },
  { key: 'p5', level: null },
];

describe('computeFoldPlan', () => {
  it('hides a section up to the next heading of the same level', () => {
    const plan = computeFoldPlan(DOC, (key) => key === 'B');
    expect(plan.hidden).toEqual(['p2', 'C', 'p3']);
  });

  it('hides subsections and stops at a higher-level heading', () => {
    const plan = computeFoldPlan(DOC, (key) => key === 'A');
    expect(plan.hidden).toEqual(['p1', 'B', 'p2', 'C', 'p3', 'D', 'p4']);
  });

  it('keeps an inner fold underneath an outer fold', () => {
    const folded = new Set(['A', 'C']);
    const plan = computeFoldPlan(DOC, (key) => folded.has(key));
    expect(plan.headings.find((h) => h.key === 'C')).toEqual({
      key: 'C',
      folded: true,
      hidden: true,
    });

    folded.delete('A');
    const unfolded = computeFoldPlan(DOC, (key) => folded.has(key));
    expect(unfolded.hidden).toEqual(['p3']);
  });

  it('offers no fold for a heading with an empty section', () => {
    const blocks: FoldBlock[] = [
      { key: 'H1', level: 2 },
      { key: 'H2', level: 2 },
      { key: 'p', level: null },
      { key: 'H3', level: 1 },
    ];
    const plan = computeFoldPlan(blocks, () => true);
    expect(plan.headings.map((h) => h.key)).toEqual(['H2']);
    expect(plan.hidden).toEqual(['p']);
  });

  it('runs a fold to the end of the document', () => {
    const plan = computeFoldPlan(DOC, (key) => key === 'E');
    expect(plan.hidden).toEqual(['p5']);
  });
});

describe('enclosingHeadings', () => {
  it('lists the sections around a block, innermost first', () => {
    expect(enclosingHeadings(DOC, 5)).toEqual(['C', 'B', 'A']);
    expect(enclosingHeadings(DOC, 7)).toEqual(['D', 'A']);
  });

  it('lists the parents of a heading, not its peers', () => {
    expect(enclosingHeadings(DOC, 6)).toEqual(['A']);
    expect(enclosingHeadings(DOC, 8)).toEqual([]);
  });
});
