import {
  CompatCaptureLeases,
  ForeignAccess,
  type IForeignRecordRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { CaptureLeases } from './capture-leases';

function record(captureId: bigint): IForeignRecordRef {
  return {
    captureId,
    updateId: 0,
    access: ForeignAccess.Frozen,
    node: {
      editorId: 1,
      version: 7n,
      key: { index: Number(captureId), generation: 2 },
      instanceOwnerId: 3,
      classId: 4,
      instanceId: 5,
    },
  };
}

test('independent owners coalesce unsent work and emit generated payloads', () => {
  const leases = new CaptureLeases(1),
    a = record(10n);
  leases.retain(a);
  leases.release(a);
  expect(leases.beginDrain()).toBeUndefined();
  leases.retain(a);
  leases.retain({ ...a, node: { ...a.node, key: { ...a.node.key } } });
  leases.release(a);
  const retain = leases.beginDrain();
  if (!retain) throw new Error('Expected retain');
  expect(
    CompatCaptureLeases.decode(CompatCaptureLeases.encode(retain.leases))
  ).toMatchObject({ editorId: 1, retain: [10n], release: [] });
  leases.acknowledge(retain);
  leases.release(a);
  leases.retain(a);
  expect(leases.beginDrain()).toBeUndefined();
  leases.release(a);
  const release = leases.beginDrain();
  if (!release) throw new Error('Expected release');
  expect(release.leases).toEqual({ editorId: 1, retain: [], release: [10n] });
  leases.acknowledge(release);
  expect(leases.beginDrain()).toBeUndefined();
  expect(() => leases.release(a)).toThrow('no local owner');
});

test('release during in-flight retain survives acknowledgement and rollback', () => {
  for (const acknowledged of [true, false]) {
    const leases = new CaptureLeases(1),
      a = record(10n);
    leases.retain(a);
    const drain = leases.beginDrain();
    if (!drain) throw new Error('Expected retain');
    leases.release(a);
    expect(() => leases.beginDrain()).toThrow('already in flight');
    if (acknowledged) {
      leases.acknowledge(drain);
      expect(leases.beginDrain()?.leases).toEqual({
        editorId: 1,
        retain: [],
        release: [10n],
      });
    } else {
      leases.rollback(drain);
      expect(leases.beginDrain()).toBeUndefined();
    }
  }
});

test('reacquisition during in-flight release preserves new ownership', () => {
  for (const acknowledged of [true, false]) {
    const leases = new CaptureLeases(1),
      a = record(10n);
    leases.retain(a);
    const first = leases.beginDrain();
    if (!first) throw new Error('Expected retain');
    leases.acknowledge(first);
    leases.release(a);
    const drain = leases.beginDrain();
    if (!drain) throw new Error('Expected release');
    leases.retain(a);
    if (acknowledged) {
      leases.acknowledge(drain);
      expect(leases.beginDrain()?.leases).toEqual({
        editorId: 1,
        retain: [10n],
        release: [],
      });
    } else {
      leases.rollback(drain);
      expect(leases.beginDrain()).toBeUndefined();
    }
  }
});

test('failed admission retries work without losing callback acquisitions or accepting stale tokens', () => {
  const leases = new CaptureLeases(1);
  leases.retain(record(10n));
  const failed = leases.beginDrain();
  if (!failed) throw new Error('Expected drain');
  leases.retain(record(20n));
  leases.rollback(failed);
  const retry = leases.beginDrain();
  if (!retry) throw new Error('Expected retry');
  expect(retry.leases).toEqual({
    editorId: 1,
    retain: [10n, 20n],
    release: [],
  });
  expect(() => leases.acknowledge(failed)).toThrow('not the active drain');
  expect(() => leases.rollback({ leases: retry.leases })).toThrow(
    'not the active drain'
  );
  leases.acknowledge(retry);
  expect(() => leases.acknowledge(retry)).toThrow('not the active drain');
  expect(leases.beginDrain()).toBeUndefined();
});

test('lease acknowledgement is separate from typed operation failure and later callback work', () => {
  const leases = new CaptureLeases(1),
    old = record(10n);
  leases.retain(old);
  const first = leases.beginDrain();
  if (!first) throw new Error('Expected retain');
  leases.acknowledge(first);
  leases.release(old);
  leases.retain(record(20n));
  const batch = leases.beginDrain();
  if (!batch) throw new Error('Expected mixed batch');
  expect(batch.leases).toEqual({ editorId: 1, retain: [20n], release: [10n] });
  leases.retain(record(30n));
  // The caller provides the actual lease ack even if the operation failed.
  leases.acknowledge(batch);
  expect(leases.beginDrain()?.leases).toEqual({
    editorId: 1,
    retain: [30n],
    release: [],
  });
});

test('all duplicate-id authority fields reject changes before altering owner counts', () => {
  const a = record(10n);
  const changed: IForeignRecordRef[] = [
    { ...a, updateId: 1 },
    { ...a, access: ForeignAccess.Writable },
    { ...a, node: { ...a.node, editorId: 2 } },
    { ...a, node: { ...a.node, version: 8n } },
    { ...a, node: { ...a.node, key: { ...a.node.key, index: 11 } } },
    { ...a, node: { ...a.node, key: { ...a.node.key, generation: 3 } } },
    { ...a, node: { ...a.node, instanceOwnerId: 4 } },
    { ...a, node: { ...a.node, classId: 5 } },
    { ...a, node: { ...a.node, instanceId: 6 } },
  ];
  for (const invalid of changed) {
    const leases = new CaptureLeases(1);
    leases.retain(a);
    expect(() => leases.retain(invalid)).toThrow();
    expect(() => leases.release(invalid)).toThrow();
    leases.release(a);
    expect(leases.beginDrain()).toBeUndefined();
  }
});

test('zero, oversized and cross-editor ids cannot enter the queue', () => {
  const leases = new CaptureLeases(1);
  for (const id of [0n, -1n, 0x10000000000000000n]) {
    expect(() => leases.retain(record(id))).toThrow('nonzero uint64');
    expect(() => leases.release(record(id))).toThrow('nonzero uint64');
  }
  const a = record(10n);
  expect(() =>
    leases.retain({ ...a, node: { ...a.node, editorId: 2 } })
  ).toThrow('another editor');
  expect(() => new CaptureLeases(0)).toThrow('valid native editor');
  expect(() => new CaptureLeases(1.5)).toThrow('valid native editor');
  expect(leases.beginDrain()).toBeUndefined();
});

test('drain payload and identity cannot be edited before acknowledgement', () => {
  const leases = new CaptureLeases(1);
  leases.retain(record(10n));
  const drain = leases.beginDrain();
  if (!drain) throw new Error('Expected drain');
  expect(() => drain.leases.retain.push(20n)).toThrow();
  expect(() => drain.leases.release.push(10n)).toThrow();
  expect(Object.isFrozen(drain)).toBe(true);
  expect(Object.isFrozen(drain.leases)).toBe(true);
  leases.rollback(drain);
  expect(leases.beginDrain()?.leases).toEqual({
    editorId: 1,
    retain: [10n],
    release: [],
  });
});

test('ten thousand live captures produce only changed-id sparse drains and exact retries', () => {
  const leases = new CaptureLeases(1);
  for (let id = 1n; id <= 10000n; id++) leases.retain(record(id));
  const initial = leases.beginDrain();
  if (!initial) throw new Error('Expected initial drain');
  expect(initial.leases.retain).toHaveLength(10000);
  leases.acknowledge(initial);
  leases.release(record(5000n));
  leases.retain(record(10001n));
  const sparse = leases.beginDrain();
  if (!sparse) throw new Error('Expected sparse drain');
  expect(sparse.leases).toEqual({
    editorId: 1,
    retain: [10001n],
    release: [5000n],
  });
  leases.rollback(sparse);
  const retry = leases.beginDrain();
  if (!retry) throw new Error('Expected retry');
  expect(retry.leases).toEqual(sparse.leases);
  leases.acknowledge(retry);
  expect(leases.beginDrain()).toBeUndefined();
});
