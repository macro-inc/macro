import {
  ForeignAccess,
  ForeignNodeKind,
  type IForeignRenderRecord,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { CapturedRecords } from './records';
import { utf16 } from './values';

function record(
  captureId: bigint,
  version: bigint,
  instanceId: number,
  text: string
): IForeignRenderRecord {
  const absent = { present: false, key: { index: 0, generation: 0 } };
  return {
    record: {
      node: {
        editorId: 1,
        version,
        key: { index: 1, generation: 0 },
        instanceOwnerId: instanceId === 0 ? 0 : 1,
        classId: instanceId === 0 ? 0 : 1,
        instanceId,
      },
      updateId: 0,
      access: ForeignAccess.Frozen,
      captureId,
    },
    hasInstance: instanceId !== 0,
    typeIndex: 1,
    typeName: 'text',
    kind: ForeignNodeKind.Text,
    base: {
      text: { text: utf16(text), format: 0, style: '', mode: 0, detail: 0 },
    },
    links: {
      parent: absent,
      previous: absent,
      next: absent,
      first: absent,
      last: absent,
      size: 0,
    },
    nativeProjection: { nativeType: 'text', complete: true, fields: [] },
    hasRootCachedText: false,
    rootCachedText: [],
  };
}

// These are generated-record cache tests, not a native model or initializer.
test('capture authority and JS instance identity have independent indexes', () => {
  const changes: [number, bigint | undefined, bigint][] = [];
  const records = new CapturedRecords((handle, previous, next) => {
    changes.push([handle, previous?.captureId, next.captureId]);
  });
  const before = record(1n, 2n, 7, 'before');
  const after = record(2n, 2n, 7, 'after');
  const cow = record(3n, 3n, 8, 'next update');
  records.accept([before]);
  const handle = records.handle(before.record);
  records.accept([before]);
  expect(changes).toHaveLength(1);
  records.accept([after]);
  expect(records.handle(after.record)).toBe(handle);
  expect(records.raw(before.record)).toEqual(records.raw(after.record));
  expect(records.reference(handle)).toBe(after.record);
  expect(records.field(handle, '__text', () => undefined)).toBe('after');
  expect(before.record.captureId).toBe(1n);
  expect(before.base.text?.text).toEqual(utf16('before'));
  records.accept([cow]);
  const next = records.handle(cow.record);
  expect(next).not.toBe(handle);
  expect(records.field(handle, '__text', () => undefined)).toBe('after');
  expect(records.field(next, '__text', () => undefined)).toBe('next update');
  expect(changes).toEqual([
    [handle, undefined, 1n],
    [handle, 1n, 2n],
    [next, undefined, 3n],
  ]);
});

test('metadata hydration adopts the new issued capture without a second JS handle', () => {
  const records = new CapturedRecords(() => {});
  const unbound = record(1n, 0n, 0, 'initial');
  const bound = record(2n, 0n, 1, 'initial');
  records.accept([unbound]);
  const handle = records.handle(unbound.record);
  records.bind(handle, bound);
  records.accept([bound]);
  expect(records.handle(bound.record)).toBe(handle);
  expect(records.reference(handle)).toBe(bound.record);
  expect(unbound.record.node.instanceId).toBe(0);
  expect(unbound.record.captureId).toBe(1n);
  expect(records.raw(bound.record)).toMatchObject({ $h: handle });
  expect(() => records.bind(handle, bound)).toThrow('Invalid captured');
});

test('graph retirement preserves carried capture payloads until their last lease ends', () => {
  const records = new CapturedRecords(() => {});
  const first = record(1n, 1n, 1, 'retained');
  const changed = record(2n, 2n, 2, 'current');
  const retained = new Set([first.record.captureId]);
  records.accept([first, changed]);
  const oldHandle = records.handle(first.record);
  const current = records.handle(changed.record);
  records.release(1n, (reference) => retained.has(reference.captureId));
  expect(records.reference(oldHandle)).toBe(first.record);
  expect(records.field(oldHandle, '__text', () => undefined)).toBe('retained');
  retained.clear();
  records.prune(1n, (reference) => retained.has(reference.captureId));
  expect(() => records.reference(oldHandle)).toThrow('released');
  expect(records.reference(current)).toBe(changed.record);
});

test('same instance cannot change node key, and capture IDs cannot change authority', () => {
  const records = new CapturedRecords(() => {});
  const first = record(1n, 1n, 1, 'source');
  records.accept([first]);
  const wrongAuthority = record(1n, 2n, 1, 'source');
  expect(() => records.accept([wrongAuthority])).toThrow('authority changed');
  const wrongKey = record(2n, 2n, 1, 'source');
  expect(() =>
    records.accept([
      {
        ...wrongKey,
        record: {
          ...wrongKey.record,
          node: { ...wrongKey.record.node, key: { index: 2, generation: 0 } },
        },
      },
    ])
  ).toThrow('changed editor, node key or type');
  expect(records.reference(records.handle(first.record))).toBe(first.record);
});

test('every ref resolver validates complete issued authority, not only capture ID', () => {
  const records = new CapturedRecords(() => {});
  const first = record(1n, 1n, 1, 'source');
  records.accept([first]);
  const reference = first.record;
  const invalid = [
    { ...reference, updateId: 7 },
    { ...reference, access: ForeignAccess.Writable },
    { ...reference, node: { ...reference.node, editorId: 2 } },
    { ...reference, node: { ...reference.node, instanceId: 2 } },
    { ...reference, node: { ...reference.node, version: 2n } },
  ];
  for (const forged of invalid) {
    expect(() => records.handle(forged)).toThrow('authority mismatch');
    expect(() => records.raw(forged)).toThrow('authority mismatch');
  }
  const otherEditor = record(2n, 1n, 1, 'source');
  expect(() =>
    records.accept([
      {
        ...otherEditor,
        record: {
          ...otherEditor.record,
          node: { ...otherEditor.record.node, editorId: 2 },
        },
      },
    ])
  ).toThrow('changed editor');
  expect(records.reference(records.handle(reference))).toBe(reference);
});

test('retiring a hydrated handle also drops its instance index through an old unbound ref', () => {
  const records = new CapturedRecords(() => {});
  const unbound = record(1n, 0n, 0, 'source');
  const bound = record(2n, 0n, 1, 'source');
  records.accept([unbound]);
  const handle = records.handle(unbound.record);
  records.bind(handle, bound);
  records.release(0n, (reference) => reference.captureId === 1n);
  expect(records.reference(handle)).toBe(unbound.record);
  records.prune(1n, () => false);
  expect(() => records.reference(handle)).toThrow('released');
  const later = record(3n, 3n, 1, 'source');
  records.accept([later]);
  expect(records.handle(later.record)).not.toBe(handle);
});
