import { expect, test } from 'vitest';
import { Mirror, NO_KEY } from './mirror';

test.each([
  { low: 0, high: 0, expected: 0n },
  { low: 1, high: 2097152, expected: 9007199254740993n },
  { low: 4294967295, high: 4294967295, expected: 18446744073709551615n },
])(
  'decorator metadata preserves the literal u64 $expected',
  ({ low, high, expected }) => {
    const mirror = new Mirror([
      { index: 0, name: 'root', kind: 'element' },
      { index: 1, name: 'image', kind: 'decorator' },
    ]);
    mirror.initialize(
      new Uint32Array([
        1,
        7,
        1,
        NO_KEY,
        3,
        4,
        1,
        1,
        0,
        2,
        12,
        1,
        low,
        high,
        6,
        0,
        1,
        1,
      ]),
      new TextEncoder().encode('{}')
    );
    expect(mirror.node(1)?.decoratorRevision).toBe(expected);
    expect(mirror.node(1)?.props()).toEqual({});
    expect(mirror.node(0)?.decoratorRevision).toBeUndefined();
  }
);

test('property changes preserve lifetime while revision-only changes leave JSON untouched', () => {
  const mirror = new Mirror([
    { index: 0, name: 'root', kind: 'element' },
    { index: 1, name: 'image', kind: 'decorator' },
  ]);
  mirror.initialize(
    new Uint32Array([
      1,
      7,
      1,
      NO_KEY,
      3,
      4,
      1,
      1,
      0,
      11,
      12,
      1,
      0,
      0,
      6,
      0,
      1,
      1,
    ]),
    new TextEncoder().encode('{"scale":1}')
  );
  const initial = mirror.node(1);
  mirror.apply(
    new Uint32Array([1, 7, 0, NO_KEY, 1, 10, 1, 0, 11]),
    new TextEncoder().encode('{"scale":2}')
  );
  const changed = mirror.node(1);
  expect(initial?.props()).toEqual({ scale: 1 });
  expect(changed?.props()).toEqual({ scale: 2 });
  expect(changed?.decoratorRevision).toBe(0n);
  const diff = mirror.apply(
    new Uint32Array([1, 7, 0, NO_KEY, 1, 12, 1, 1, 0]),
    new Uint8Array()
  );
  expect(mirror.node(1)?.decoratorRevision).toBe(1n);
  expect(mirror.node(1)?.propsJSON).toBe(changed?.propsJSON);
  expect(diff.mutations.get(1)?.before).toBe(changed);
  expect(diff.mutations.get(1)?.after).toBe(mirror.node(1));
  expect(diff.children.size).toBe(0);
});

test('invalid metadata targets and truncated payloads roll back the entire Diff', () => {
  const mirror = new Mirror([
    { index: 0, name: 'root', kind: 'element' },
    { index: 1, name: 'image', kind: 'decorator' },
  ]);
  mirror.initialize(
    new Uint32Array([
      1,
      7,
      1,
      NO_KEY,
      3,
      4,
      1,
      1,
      0,
      2,
      12,
      1,
      0,
      0,
      6,
      0,
      1,
      1,
    ]),
    new TextEncoder().encode('{}')
  );
  const before = mirror.node(1);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 7, 0, NO_KEY, 2, 12, 1, 1, 0, 12, 0, 1, 0]),
      new Uint8Array()
    )
  ).toThrow('Decorator revision on a non-decorator');
  expect(mirror.node(1)).toBe(before);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 7, 0, NO_KEY, 1, 12, 1, 1]),
      new Uint8Array()
    )
  ).toThrow('Truncated Diff');
  expect(mirror.node(1)).toBe(before);
});
