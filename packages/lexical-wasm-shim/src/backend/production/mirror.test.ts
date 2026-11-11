import {
  ForeignAccess,
  ForeignNodeKind,
  type IForeignRecordRef,
  type IForeignRenderRecord,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { type CaptureRetentionDelta, RecordMirror } from './mirror';
import { LazyNodeMap } from './node-map';

function ack(index: number, version: bigint): IForeignRenderRecord {
  const absent = { present: false, key: { index: 0, generation: 0 } };
  return {
    record: {
      node: {
        editorId: 1,
        version,
        key: { index, generation: 0 },
        instanceOwnerId: 1,
        classId: 1,
        instanceId: index,
      },
      updateId: 0,
      access: ForeignAccess.Frozen,
      captureId: version * 100000n + BigInt(index),
    },
    hasInstance: true,
    typeIndex: 0,
    typeName: 'element',
    kind: ForeignNodeKind.Element,
    base: {},
    links: {
      parent: absent,
      previous: absent,
      next: absent,
      first: absent,
      last: absent,
      size: 0,
    },
    nativeProjection: { nativeType: 'element', complete: true, fields: [] },
    hasRootCachedText: false,
    rootCachedText: [],
  };
}

test('complete snapshot is mandatory; sparse updates preserve frozen exact records and counts', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 1n),
    b = ack(2, 1n),
    changed = ack(1, 2n);
  mirror.apply(1n, [a]);
  expect(() => mirror.count(1n)).toThrow('full snapshot');
  expect(() => new LazyNodeMap(mirror, 1n, (r) => r)).toThrow('full snapshot');
  mirror.replace(1n, [a, b]);
  mirror.apply(2n, [changed], [{ index: 2, generation: 0 }]);
  expect(mirror.get(1n, '1')).toBe(a.record);
  expect(mirror.get(1n, '2')).toBe(b.record);
  expect(mirror.count(1n)).toBe(2);
  expect(mirror.get(2n, '1')).toBe(changed.record);
  expect(mirror.get(2n, '2')).toBeNull();
  expect(mirror.count(2n)).toBe(1);
  mirror.discard(2n);
  expect(() => mirror.get(2n, '1')).toThrow('not acknowledged');
  expect(mirror.get(1n, '1')).toBe(a.record);
});

test('remove and reinsert appends, including within a version and after allocation GC', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 1n),
    b = ack(2, 1n),
    c = ack(3, 1n);
  mirror.replace(1n, [a, b, c]);
  mirror.apply(2n, [], [{ index: 1, generation: 0 }]);
  mirror.apply(2n, [ack(1, 2n)]);
  expect([...mirror.keys(1n)]).toEqual(['1', '2', '3']);
  expect([...mirror.keys(2n)]).toEqual(['2', '3', '1']);
  mirror.apply(3n, [ack(2, 3n)]);
  mirror.release(1n);
  mirror.release(2n);
  expect([...mirror.keys(3n)]).toEqual(['2', '3', '1']);
  expect(mirror.count(3n)).toBe(3);
  expect(mirror.get(3n, '3')).toBe(c.record);
  mirror.apply(4n, [ack(4, 4n)]);
  mirror.discard(4n);
  mirror.apply(5n, []);
  mirror.release(3n);
  expect([...mirror.keys(5n)]).toEqual(['2', '3', '1']);
  expect(mirror.get(5n, '3')).toBe(c.record);
});

test('historical snapshots never introduce absent old keys across a newer full snapshot', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 5n),
    b = ack(2, 5n);
  mirror.replace(5n, [b, a]);
  mirror.apply(6n, [ack(3, 6n)]);
  mirror.replace(2n, [ack(1, 2n), ack(4, 2n)]);
  expect([...mirror.keys(2n)]).toEqual(['1', '4']);
  expect([...mirror.keys(5n)]).toEqual(['2', '1']);
  expect([...mirror.keys(6n)]).toEqual(['2', '1', '3']);
  expect(mirror.get(5n, '4')).toBeNull();
  expect(mirror.count(5n)).toBe(2);
  expect(mirror.count(6n)).toBe(3);
  mirror.release(2n);
  expect(mirror.get(5n, '1')).toBe(a.record);
});

test('historical full snapshot order propagates to later sparse states and discards restore counts', () => {
  const mirror = new RecordMirror();
  mirror.replace(1n, [ack(1, 1n), ack(2, 1n)]);
  mirror.apply(2n, [ack(3, 2n)]);
  mirror.apply(3n, [ack(2, 3n)]);
  mirror.replace(2n, [ack(2, 2n), ack(1, 2n), ack(3, 2n)]);
  expect([...mirror.keys(3n)]).toEqual(['2', '1', '3']);
  expect(mirror.count(3n)).toBe(3);
  mirror.apply(4n, [], [{ index: 1, generation: 0 }]);
  expect(mirror.count(4n)).toBe(2);
  mirror.discard(4n);
  mirror.apply(5n, []);
  expect(mirror.count(5n)).toBe(3);
  expect([...mirror.keys(5n)]).toEqual(['2', '1', '3']);
});

test('real readonly Map resolves only requested nodes; key and size reads stay lazy', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 1n),
    b = ack(2, 1n);
  mirror.replace(1n, [a, b]);
  let resolves = 0;
  const map = new LazyNodeMap(mirror, 1n, (record) => {
    resolves++;
    return record;
  });
  expect(map).toBeInstanceOf(Map);
  expect(map.size).toBe(2);
  expect(map.has('1')).toBe(true);
  expect(map.has('missing')).toBe(false);
  expect([...map.keys()]).toEqual(['1', '2']);
  expect(resolves).toBe(0);
  expect(map.get('missing')).toBeUndefined();
  expect(resolves).toBe(0);
  expect(map.get('2')).toBe(b.record);
  expect(resolves).toBe(1);
  expect([...map.values()]).toEqual([a.record, b.record]);
  expect([...map]).toEqual([
    ['1', a.record],
    ['2', b.record],
  ]);
  const context: { seen: string[] } = { seen: [] };
  map.forEach(function (value, key, actual) {
    expect(actual).toBe(map);
    expect(value).toBe(mirror.get(1n, key));
    context.seen.push(key);
  }, context);
  expect(context.seen).toEqual(['1', '2']);
  expect(() => map.set('3', a.record)).toThrow(TypeError);
  expect(() => map.delete('1')).toThrow(TypeError);
  expect(() => map.clear()).toThrow(TypeError);
  expect(map.size).toBe(2);
});

test('large sparse commits and lifecycle operations never request key enumeration or node resolution', () => {
  class EnumerationGuard extends RecordMirror {
    override keys(_version: bigint): IterableIterator<string> {
      throw new Error('unexpected enumeration');
    }
  }
  const mirror = new EnumerationGuard();
  mirror.replace(
    1n,
    Array.from({ length: 12000 }, (_, index) => ack(index, 1n))
  );
  let resolves = 0;
  const map = new LazyNodeMap(mirror, 1n, (record) => {
    resolves++;
    return record;
  });
  mirror.apply(2n, [ack(6000, 2n)], [{ index: 7000, generation: 0 }]);
  mirror.release(1n);
  mirror.discard(2n);
  mirror.apply(3n, []);
  expect(map instanceof Map).toBe(true);
  expect(mirror.count(3n)).toBe(12000);
  expect(resolves).toBe(0);
  expect(mirror.get(3n, '7000')).not.toBeNull();
});

test('sparse linear receipts match JavaScript Map ordering through retained snapshots and GC', () => {
  const leased = new Set<IForeignRecordRef>();
  const mirror = new RecordMirror(({ retain, release }) => {
    for (const record of retain) {
      expect(leased.has(record)).toBe(false);
      leased.add(record);
    }
    for (const record of release) {
      expect(leased.delete(record)).toBe(true);
    }
  });
  const initial = ack(1, 1n);
  mirror.replace(1n, [initial]);
  const states = new Map<bigint, Map<string, IForeignRenderRecord>>([
    [1n, new Map([['1', initial]])],
  ]);
  let current = 1n;
  let seed = 0x75e4;
  for (let step = 0; step < 240; step++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const index = 1 + ((seed >>> 0) % 40),
      key = String(index),
      version = BigInt(step + 2);
    const state = new Map(states.get(current));
    if ((seed & 3) === 0) {
      state.delete(key);
      mirror.apply(version, [], [{ index, generation: 0 }]);
    } else {
      const value = ack(index, version);
      state.set(key, value);
      mirror.apply(version, [value]);
    }
    if (step % 5 === 0) mirror.discard(version);
    else {
      states.set(version, state);
      current = version;
    }
    if (step % 7 === 0 && states.size > 3) {
      const oldest = states.keys().next().value;
      if (oldest !== undefined && oldest !== current) {
        mirror.release(oldest);
        states.delete(oldest);
      }
    }
    if (step % 17 === 0) {
      const entries = [...states];
      const historical = entries[(seed >>> 0) % entries.length];
      mirror.replace(historical[0], [...historical[1].values()]);
    }
    for (const [version, expected] of states) {
      expect(mirror.count(version)).toBe(expected.size);
      expect([...mirror.keys(version)]).toEqual([...expected.keys()]);
      for (const [key, value] of expected) {
        expect(mirror.get(version, key)).toBe(value.record);
        expect(leased.has(value.record)).toBe(true);
      }
    }
  }
}, 30000);

test('complete head and rollback survive collection of every exposed allocation version', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 1n),
    b = ack(2, 1n);
  mirror.replace(1n, [a, b]);
  mirror.apply(2n, [], [{ index: 1, generation: 0 }]);
  mirror.release(1n);
  mirror.release(2n);
  expect(() => mirror.count(2n)).toThrow('not acknowledged');
  mirror.apply(3n, []);
  expect(mirror.count(3n)).toBe(1);
  expect([...mirror.keys(3n)]).toEqual(['2']);
  expect(mirror.get(3n, '2')).toBe(b.record);
  const rollback = new RecordMirror();
  rollback.replace(1n, [a, b]);
  rollback.apply(2n, [ack(1, 2n)]);
  rollback.release(1n);
  rollback.discard(2n);
  rollback.apply(3n, []);
  expect(rollback.count(3n)).toBe(2);
  expect([...rollback.keys(3n)]).toEqual(['1', '2']);
  expect(rollback.get(3n, '1')).toBe(a.record);
});

test('nonhead discard rejects before changing acknowledged descendants', () => {
  const mirror = new RecordMirror(),
    a = ack(1, 1n),
    b = ack(2, 1n);
  mirror.replace(1n, [a, b]);
  mirror.replace(2n, [b]);
  mirror.apply(3n, []);
  expect(() => mirror.discard(2n)).toThrow('active head');
  expect(mirror.count(3n)).toBe(1);
  expect([...mirror.keys(3n)]).toEqual(['2']);
  expect(mirror.get(3n, '1')).toBeNull();
  mirror.release(2n);
  expect([...mirror.keys(3n)]).toEqual(['2']);
  const pending = new RecordMirror();
  pending.replace(1n, [a, b]);
  pending.replace(2n, [b, a]);
  pending.discard(2n);
  pending.apply(3n, []);
  expect([...pending.keys(3n)]).toEqual(['1', '2']);
  expect(pending.count(3n)).toBe(2);
});

test('capture leases survive allocation GC through undo and released head bases', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const a = ack(1, 1n),
    b = ack(1, 2n),
    c = ack(1, 3n);
  mirror.replace(1n, [a]);
  mirror.apply(2n, [b]);
  mirror.release(1n);
  expect(deltas).toEqual([
    { retain: [a.record], release: [] },
    { retain: [b.record], release: [] },
  ]);
  mirror.apply(3n, [c]);
  mirror.release(2n);
  expect(deltas.at(-1)).toEqual({ retain: [], release: [a.record] });
  // b's history entry is gone, but provisional version 3 still owns its undo.
  mirror.discard(3n);
  expect(deltas.at(-1)).toEqual({ retain: [], release: [c.record] });
  mirror.apply(4n, []);
  expect(mirror.get(4n, '1')).toBe(b.record);
  mirror.release(4n);
  mirror.apply(5n, []);
  expect(mirror.get(5n, '1')).toBe(b.record);
  mirror.apply(6n, [], [{ index: 1, generation: 0 }]);
  mirror.release(5n);
  const before = deltas.length;
  mirror.release(6n);
  expect(deltas.slice(before)).toEqual([{ retain: [], release: [b.record] }]);
});

test('one transition reports only net exact refs, retaining before releasing', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const a = ack(1, 1n),
    b = ack(1, 1n),
    c = ack(1, 1n);
  mirror.replace(1n, [a]);
  // Distinct decoded objects remain exact authorities even with equal fields.
  mirror.apply(1n, [b, c]);
  expect(deltas).toHaveLength(2);
  expect(deltas[1].retain).toHaveLength(1);
  expect(deltas[1].retain[0]).toBe(c.record);
  expect(deltas[1].release).toHaveLength(1);
  expect(deltas[1].release[0]).toBe(a.record);
  mirror.apply(1n, [c, c]);
  expect(deltas).toHaveLength(2);
  mirror.discard(1n);
  expect(deltas[2]).toEqual({ retain: [], release: [c.record] });
});

test('historical readers and full snapshot absence keep exact leases until collection', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const a = ack(1, 1n),
    b = ack(2, 1n),
    c = ack(1, 2n);
  mirror.replace(1n, [a, b]);
  mirror.replace(2n, [c]);
  mirror.apply(3n, []);
  mirror.release(2n);
  expect(deltas).toEqual([
    { retain: [a.record, b.record], release: [] },
    { retain: [c.record], release: [] },
  ]);
  expect([...mirror.records(1n)]).toEqual([a.record, b.record]);
  mirror.release(1n);
  expect(deltas.at(-1)).toEqual({ retain: [], release: [a.record, b.record] });
  expect([...mirror.records(3n)]).toEqual([c.record]);
});

test('sparse leases scale with changed refs and empty or rejected transitions emit nothing', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const full = Array.from({ length: 12000 }, (_, index) => ack(index, 1n));
  mirror.replace(1n, full);
  const changed = ack(30, 2n);
  mirror.apply(2n, [changed]);
  expect(deltas[0].retain).toHaveLength(12000);
  expect(deltas[1]).toEqual({ retain: [changed.record], release: [] });
  mirror.apply(3n, []);
  mirror.release(1n);
  expect(() => mirror.discard(2n)).toThrow('active head');
  expect(deltas).toHaveLength(2);
  mirror.release(2n);
  expect(deltas[2]).toEqual({ retain: [], release: [full[30].record] });
  const before = deltas.length;
  mirror.release(2n);
  mirror.release(3n);
  expect(deltas).toHaveLength(before);
});

test('retention callbacks cannot mutate the mirror reentrantly', () => {
  let mirror: RecordMirror;
  mirror = new RecordMirror(() => {
    expect(() => mirror.apply(2n, [])).toThrow('must not reenter');
  });
  const a = ack(1, 1n);
  mirror.replace(1n, [a]);
  expect(mirror.get(1n, '1')).toBe(a.record);
  mirror.apply(2n, []);
  expect(mirror.get(2n, '1')).toBe(a.record);
});

test('collecting an absent historical key releases its last capture', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const current = ack(1, 5n),
    historical = ack(2, 2n);
  mirror.replace(5n, [current]);
  mirror.replace(2n, [historical]);
  expect(mirror.get(5n, '2')).toBeNull();
  mirror.release(2n);
  expect(deltas.at(-1)).toEqual({ retain: [], release: [historical.record] });
  mirror.release(5n);
  mirror.apply(6n, []);
  expect([...mirror.records(6n)]).toEqual([current.record]);
});

test('parent-only basis leases are revisited when the owning lineage entry leaves', () => {
  const deltas: CaptureRetentionDelta[] = [];
  const mirror = new RecordMirror((delta) => deltas.push(delta));
  const b = ack(2, 1n);
  mirror.replace(1n, [b]);
  mirror.apply(3n, []);
  mirror.release(1n);
  // This historical absence propagates to sparse head 3, but parent 1 remains
  // the rollback basis of 3 even after allocation version 1 was collected.
  mirror.replace(2n, []);
  mirror.release(2n);
  expect(mirror.get(3n, '2')).toBeNull();
  expect(deltas).toEqual([{ retain: [b.record], release: [] }]);
  mirror.release(3n);
  expect(deltas.at(-1)).toEqual({ retain: [], release: [b.record] });
});
