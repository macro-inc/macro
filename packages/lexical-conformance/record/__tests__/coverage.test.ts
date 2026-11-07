import { expect, test } from 'vitest';
import { coveredPoints } from '../coverage';
import { FunctionCoverage, PatchLines } from '../coverage-map';

test('missing child function coverage cannot inherit an executed parent counter', () => {
  const source = 'function outer(){function child(){hidden();} visible();}';
  const hidden = { offset: source.indexOf('hidden') };
  const visible = { offset: source.indexOf('visible') };
  const coverage = new FunctionCoverage(source, [hidden, visible]);
  const parent = {
    ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
  };
  expect(coverage.covered([parent], coveredPoints)).toEqual([visible]);
  const child = {
    ranges: [
      {
        startOffset: source.indexOf('function child'),
        endOffset: source.indexOf(' visible'),
        count: 1,
      },
    ],
  };
  expect(coverage.covered([parent, child], coveredPoints)).toEqual([
    visible,
    hidden,
  ]);
  child.ranges.push({
    startOffset: hidden.offset,
    endOffset: hidden.offset + 6,
    count: 0,
  });
  expect(coverage.covered([parent, child], coveredPoints)).toEqual([visible]);
});

test('patch coverage restores pristine lines and excludes inserted instrumentation', () => {
  const lines = new PatchLines(
    [
      '--- a/source.ts',
      '+++ b/source.ts',
      '@@ -2,2 +2,3 @@',
      ' original',
      '+hook',
      ' next',
      '@@ -8,2 +9,1 @@',
      '-removed',
      ' retained',
    ].join('\n')
  );
  expect(
    [1, 2, 3, 4, 8, 9, 10].map((line) => lines.original('source.ts', line))
  ).toEqual([1, 2, undefined, 3, 7, 9, 10]);
  expect(lines.original('unpatched.ts', 3)).toBe(3);
});

test('class initializers cannot inherit program coverage before construction', () => {
  const source =
    'class Sample { bare; field = initialize(); static { initializeStatic(); } }';
  const coverage = new FunctionCoverage(source, [
    { offset: source.indexOf('bare') },
    { offset: source.indexOf('initialize()') },
    { offset: source.indexOf('initializeStatic()') },
  ]);
  expect(
    coverage.covered(
      [{ ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] }],
      coveredPoints
    )
  ).toEqual([]);
});

test('program and uncalled function with identical spans retain separate counters', () => {
  const source = 'function untouched(){return 7}';
  const coverage = new FunctionCoverage(source, [
    { offset: source.indexOf('return') },
  ]);
  expect(
    coverage.covered(
      [
        {
          functionName: '',
          ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
        },
        {
          functionName: 'untouched',
          ranges: [{ startOffset: 0, endOffset: source.length, count: 0 }],
        },
      ],
      coveredPoints
    )
  ).toEqual([]);
});

test('coverage keeps inner hits, excludes unexecuted branches and expires ranges', () => {
  expect(
    coveredPoints(
      [0, 10, 20, 25, 30, 60, 99, 100].map((offset) => ({ offset })),
      [
        { startOffset: 0, endOffset: 100, count: 1 },
        { startOffset: 20, endOffset: 60, count: 0 },
        { startOffset: 25, endOffset: 30, count: 2 },
      ]
    )
  ).toEqual([
    { offset: 0 },
    { offset: 10 },
    { offset: 25 },
    { offset: 60 },
    { offset: 99 },
  ]);
});

test('coverage interval sweep agrees with a smallest-range oracle across overlaps', () => {
  const points = Array.from({ length: 201 }, (_, offset) => ({ offset }));
  const ranges = Array.from({ length: 100 }, (_, index) => {
    const startOffset = (index * 19) % 127;
    return {
      startOffset,
      endOffset: startOffset + ((index * 13) % 17) + 1,
      count: index % 3,
    };
  });
  const smallestFirst = [...ranges].sort(
    (a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset)
  );
  const expected = points.filter(
    (point) =>
      smallestFirst.find(
        (range) =>
          range.startOffset <= point.offset && point.offset < range.endOffset
      )?.count
  );
  expect(coveredPoints(points, ranges)).toEqual(expected);
});
