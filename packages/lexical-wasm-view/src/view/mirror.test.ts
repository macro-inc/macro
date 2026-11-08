import { expect, test } from 'vitest';
import { Mirror, NO_KEY } from './mirror';
import type { TypeRow } from './types';

const types: TypeRow[] = [
  { index: 0, name: 'root', kind: 'element' },
  { index: 1, name: 'paragraph', kind: 'element' },
  { index: 2, name: 'text', kind: 'text' },
];
function initialized(): Mirror {
  const mirror = new Mirror(types);
  mirror.apply(
    new Uint32Array([
      1,
      0,
      1,
      NO_KEY,
      5,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      2,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      3,
      2,
      2,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      6,
      0,
      1,
      1,
      6,
      1,
      1,
      2,
    ]),
    new TextEncoder().encode('a')
  );
  return mirror;
}
test('immutable records advance through the same Diff applier on local acknowledgement', () => {
  const mirror = initialized();
  const previous = mirror.node(2);
  const diff = mirror.acknowledgeText(2, 'a😀');
  expect(previous?.text).toBe('a');
  expect(mirror.node(2)?.text).toBe('a😀');
  expect(mirror.node(2)?.parent).toBe(1);
  expect(diff.mutations.get(2)?.kind).toBe('updated');
  expect(diff.children.size).toBe(0);
});
test('authoritative text correction replaces the submitted value', () => {
  const mirror = initialized();
  mirror.apply(
    new Uint32Array([1, 0, 0, NO_KEY, 1, 7, 2, 0, 10]),
    new TextEncoder().encode('normalized')
  );
  expect(mirror.node(2)?.text).toBe('normalized');
});
test('generation and string bounds are strict', () => {
  const mirror = initialized();
  expect(() =>
    mirror.apply(new Uint32Array([1, 1, 0, NO_KEY, 0]), new Uint8Array())
  ).toThrow('generation');
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 1, 7, 2, 0, 10]),
      new Uint8Array()
    )
  ).toThrow('string range');
});
test('subtree removal destroys every descendant record', () => {
  const mirror = initialized();
  const diff = mirror.apply(
    new Uint32Array([1, 0, 0, NO_KEY, 2, 1, 1, 1, 6, 0, 0]),
    new Uint8Array()
  );
  expect(mirror.node(1)).toBeNull();
  expect(mirror.node(2)).toBeNull();
  expect(diff.mutations.get(2)?.kind).toBe('destroyed');
});

test('malformed graph updates roll back changed records without copying clean subtrees', () => {
  const mirror = initialized();
  const original = mirror.node(1);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 2, 7, 2, 0, 1, 6, 1, 1, 0]),
      new TextEncoder().encode('b')
    )
  ).toThrow('Cyclic');
  expect(mirror.node(1)).toBe(original);
  expect(mirror.node(0)?.children).toEqual([1]);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 1, 1, 0, 1]),
      new Uint8Array()
    )
  ).toThrow('root');
  expect(mirror.node(2)?.text).toBe('a');
});
