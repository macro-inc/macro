import { DiffOpcode } from '@macro-inc/collaboration/session/abi.generated';
import { expect, test, vi } from 'vitest';
import { Mirror, NO_KEY } from './mirror';
import type { TypeRow } from './types';

const types: TypeRow[] = [
  { index: 0, name: 'root', kind: 'element' },
  { index: 1, name: 'paragraph', kind: 'element' },
  { index: 2, name: 'text', kind: 'text' },
  { index: 9, name: 'heading', kind: 'element' },
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
  expect(mirror.textLength).toBe(3);
});
test('authoritative text correction replaces the submitted value', () => {
  const mirror = initialized();
  mirror.apply(
    new Uint32Array([1, 0, 0, NO_KEY, 1, 7, 2, 0, 10]),
    new TextEncoder().encode('normalized')
  );
  expect(mirror.node(2)?.text).toBe('normalized');
  expect(mirror.textLength).toBe(10);
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
  expect(mirror.textLength).toBe(1);
});
test('each explicit subtree removal destroys its own record', () => {
  const mirror = initialized();
  const diff = mirror.apply(
    new Uint32Array([1, 0, 0, NO_KEY, 3, 1, 1, 1, 1, 2, 0, 6, 0, 0]),
    new Uint8Array()
  );
  expect(mirror.node(1)).toBeNull();
  expect(mirror.node(2)).toBeNull();
  expect(diff.mutations.get(2)?.kind).toBe('destroyed');
  expect(mirror.textLength).toBe(0);
});

test('native heading diff reparents the retained text without creating it again', () => {
  const mirror = initialized();
  mirror.acknowledgeText(2, 'Body text');
  // Packet captured from the 755c66e849 heading transform.
  const diff = mirror.apply(
    new Uint32Array([
      1,
      0,
      0,
      NO_KEY,
      4,
      1,
      1,
      1,
      2,
      3,
      9,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      12,
      6,
      0,
      1,
      3,
      6,
      3,
      1,
      2,
    ]),
    new TextEncoder().encode('{"tag":"h2"}')
  );
  expect(mirror.node(1)).toBeNull();
  expect(mirror.node(0)?.children).toEqual([3]);
  expect(mirror.node(3)?.children).toEqual([2]);
  expect(mirror.node(2)).toMatchObject({ parent: 3, text: 'Body text' });
  expect(diff.mutations.get(2)?.kind).toBe('updated');
  expect(mirror.textLength).toBe(9);
});
test('removal with a surviving child still pointing to its old parent rolls back', () => {
  const mirror = initialized();
  const before = [...mirror.values()];
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 2, 1, 1, 1, 6, 0, 0]),
      new Uint8Array()
    )
  ).toThrow('missing parent');
  for (const record of before) expect(mirror.node(record.key)).toBe(record);
  expect(mirror.textLength).toBe(1);
  expect(mirror.isEmpty).toBe(false);
});
test('duplicate removal rejects the missing record and rolls back', () => {
  const mirror = initialized();
  const before = mirror.node(1);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 2, 1, 1, 1, 1, 1, 0]),
      new Uint8Array()
    )
  ).toThrow('Removing missing key: 1');
  expect(mirror.node(1)).toBe(before);
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

test('maintained emptiness changes only after successful graph admission', () => {
  const mirror = initialized();
  expect(mirror.isEmpty).toBe(false);
  expect(() =>
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 2, 7, 2, 0, 1, 6, 1, 1, 0]),
      new TextEncoder().encode('b')
    )
  ).toThrow('Cyclic');
  expect(mirror.isEmpty).toBe(false);
  mirror.apply(
    new Uint32Array([1, 0, 0, NO_KEY, 3, 1, 1, 1, 1, 2, 0, 6, 0, 0]),
    new Uint8Array()
  );
  expect(mirror.isEmpty).toBe(true);
});

for (const size of [64, 4096]) {
  test(`emptiness admission and observation do not walk root children (${size})`, () => {
    const mirror = new Mirror(types);
    const words = [1, 0, 1, NO_KEY, size + 2];
    words.push(2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let key = 1; key <= size; key++)
      words.push(2, key, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    words.push(6, 0, size, ...Array.from({ length: size }, (_, i) => i + 1));
    mirror.initialize(new Uint32Array(words), new Uint8Array());
    expect(mirror.isEmpty).toBe(true);
    const children = mirror.node(0)?.children;
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 1, DiffOpcode.NodeProps, 0, 0, 0]),
      new Uint8Array()
    );
    expect(mirror.node(0)?.children).toBe(children);
    expect(Object.isFrozen(children)).toBe(true);
    const text = new TextEncoder().encode('typed');
    const reads = vi.spyOn(Map.prototype, 'get');
    let count = 0;
    let empty: boolean | null = null;
    try {
      mirror.apply(
        new Uint32Array([
          1,
          0,
          0,
          NO_KEY,
          2,
          3,
          size + 1,
          2,
          0,
          0,
          0,
          0,
          text.length,
          0,
          0,
          0,
          0,
          6,
          size,
          1,
          size + 1,
        ]),
        text
      );
      for (let i = 0; i < 100; i++) empty = mirror.isEmpty;
      count = reads.mock.calls.length;
    } finally {
      reads.mockRestore();
    }
    expect(empty).toBe(false);
    expect(count).toBeLessThan(32);
    mirror.apply(
      new Uint32Array([1, 0, 0, NO_KEY, 2, 1, size + 1, 1, 6, size, 0]),
      new Uint8Array()
    );
    expect(mirror.isEmpty).toBe(true);
  });
}
