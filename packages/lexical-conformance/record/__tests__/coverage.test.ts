import { expect, test } from 'vitest';
import { coveredPoints } from '../coverage';

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
