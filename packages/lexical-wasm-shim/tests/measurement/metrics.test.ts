import { describe, expect, it } from 'vitest';
import {
  evaluateCounters,
  type FixtureMeasurements,
} from '../../src/measurement/gate';
import { AuditRecorder, windowMetrics } from '../../src/measurement/metrics';
import {
  bindAuditRecorder,
  measureApi,
  measureBatchApi,
  measureBuffer,
  measurePhysical,
  measureTableReference,
  measureWindow,
  withBatchPurpose,
} from '../../src/measurement/runtime';
import { validateTrace } from '../../src/measurement/validate';

describe('raw boundary observations', () => {
  it('counts both callback directions once, reverses return bytes and retains raw reference slots', () => {
    const recorder = new AuditRecorder();
    const key = recorder.openWindow('keystroke', 'a');
    const update = recorder.openWindow('update', 'a');
    const api = recorder.enter('api', 'js-to-wasm', 'compatBatch', 'fixed');
    recorder.buffer('js-to-wasm', 'request', 80);
    const native = recorder.enter(
      'physical',
      'js-to-wasm',
      'batch',
      'operation',
      12,
      1
    );
    const callback = recorder.enter(
      'api',
      'wasm-to-js',
      'dispatch',
      'operation'
    );
    const imported = recorder.enter(
      'physical',
      'wasm-to-js',
      'call',
      'operation',
      8,
      2
    );
    recorder.buffer('wasm-to-js', 'callbackRequest', 40);
    recorder.buffer('js-to-wasm', 'callbackReply', 20);
    recorder.leave(imported, true, 4, 1);
    recorder.leave(callback, true);
    recorder.leave(native, true, 16, 0);
    recorder.buffer('wasm-to-js', 'reply', 60);
    recorder.leave(api, true);
    recorder.closeWindow(update, true);
    recorder.closeWindow(key, true);
    const trace = recorder.snapshot();
    const expected = {
      apiCalls: 2,
      fixedApiCalls: 1,
      physicalCrossings: 2,
      numericAbiBytes: 40,
      bufferPayloadBytes: 200,
      refSlots: 4,
      abiRefSlots: 4,
      tableRefSlots: 0,
      referenceAccountingBytes: 32,
      bytes: 272,
      jsToWasmRefSlots: 2,
      wasmToJsRefSlots: 2,
      jsToWasmScalarBytes: 16,
      wasmToJsScalarBytes: 24,
      jsToWasmBufferBytes: 100,
      wasmToJsBufferBytes: 100,
      completed: true,
    };
    expect(windowMetrics(trace, key)).toEqual(expected);
    expect(windowMetrics(trace, update)).toEqual(expected);
    expect(trace.calls.map((call) => call.parentId)).toEqual([null, 1, 2, 3]);
    expect(Object.isFrozen(trace.references)).toBe(true);
  });

  it('permits a read inside a hosted callback without attributing the earlier entry to the read', () => {
    const recorder = new AuditRecorder();
    const api = recorder.enter('api', 'wasm-to-js', 'host', 'operation');
    const read = recorder.openWindow('read', 'callback-local');
    recorder.closeWindow(read, true);
    recorder.leave(api, true);
    expect(windowMetrics(recorder.snapshot(), read).apiCalls).toBe(0);
  });

  it('preserves actual results and opaque throws while marking failed calls', () => {
    const recorder = new AuditRecorder();
    const unbind = bindAuditRecorder(recorder, () => false);
    const result = {};
    const error = {};
    try {
      expect(
        measureApi('input', 'operation', () =>
          measurePhysical('input', 'js-to-wasm', 4, 4, 0, 0, () => result)
        )
      ).toBe(result);
      expect(() =>
        measurePhysical('bad', 'wasm-to-js', 4, 8, 1, 1, () => {
          throw error;
        })
      ).toThrow(error);
      measureBuffer('js-to-wasm', 'empty', 0);
    } finally {
      unbind();
    }
    const trace = recorder.snapshot();
    expect(trace.calls.map((call) => call.completed)).toEqual([
      true,
      true,
      false,
    ]);
    expect(trace.bytes.filter((entry) => entry.method === 'bad')).toHaveLength(
      1
    );
    expect(
      trace.references.filter((entry) => entry.method === 'bad')
    ).toHaveLength(1);
    expect(() => measureApi('unbound', 'operation', () => 1)).toThrow(
      'requires an audit recorder'
    );
  });

  it('fails closed on unfinished, misnested, overlapping and double-counted records', () => {
    const pending = new AuditRecorder();
    pending.openWindow('read', 'pending');
    expect(() => pending.snapshot()).toThrow('unfinished');
    const invalid = new AuditRecorder();
    const a = invalid.openWindow('keystroke', 'first');
    expect(() => invalid.openWindow('keystroke', 'second')).toThrow('overlap');
    invalid.closeWindow(a, true);
    expect(() => invalid.snapshot()).toThrow('invalid');
    const order = new AuditRecorder();
    const one = order.enter('api', 'js-to-wasm', 'one', 'operation');
    order.enter('physical', 'js-to-wasm', 'two', 'operation');
    expect(() => order.leave(one, true)).toThrow('entry order');
    const doubled = new AuditRecorder();
    expect(() =>
      doubled.enter('api', 'js-to-wasm', 'wrong', 'fixed', 8)
    ).toThrow('physical');
    expect(() =>
      new AuditRecorder().buffer('js-to-wasm', 'negative', -1)
    ).toThrow('nonnegative');
  });

  it('closes synchronous scopes on opaque throws and keeps cold phases visible', () => {
    const recorder = new AuditRecorder();
    const unbind = bindAuditRecorder(recorder, () => false);
    const error = {};
    try {
      expect(() =>
        measureWindow('read', 'throw', () => {
          throw error;
        })
      ).toThrow(error);
      recorder.setPhase('gc');
      measureApi('release', 'operation', () => 1);
      recorder.setPhase('diagnostic');
      measurePhysical('snapshot', 'js-to-wasm', 4, 4, 0, 0, () => 1);
    } finally {
      unbind();
    }
    const trace = recorder.snapshot();
    expect(trace.windows[0].completed).toBe(false);
    expect(trace.calls.map((entry) => entry.phase)).toEqual([
      'gc',
      'diagnostic',
    ]);
    expect(trace.schemaVersion).toBe(1);
  });

  it('retains an attempted API and its native throw if the batch classifier rejects the packet', () => {
    const recorder = new AuditRecorder();
    const nativeError = {};
    const unbind = bindAuditRecorder(recorder, () => {
      throw new Error('malformed batch');
    });
    let invoked = false;
    try {
      expect(() =>
        measureBatchApi(
          'EditorSession.compatBatch',
          new Uint8Array([255]),
          () => {
            invoked = true;
            throw nativeError;
          }
        )
      ).toThrow(nativeError);
    } finally {
      unbind();
    }
    expect(invoked).toBe(true);
    const trace = recorder.snapshot();
    expect(trace.calls).toMatchObject([
      { method: 'EditorSession.compatBatch', completed: false },
    ]);
    expect(validateTrace(trace)).toEqual(['Unclassified boundary observation']);
  });
});

describe('table traffic and explicit lifecycle association', () => {
  it('charges real table get/set reference traffic without adding function entries', () => {
    const recorder = new AuditRecorder();
    const unbind = bindAuditRecorder(recorder, () => false);
    const table = new WebAssembly.Table({ element: 'externref', initial: 1 });
    const object = {};
    const window = recorder.openWindow('diagnostic', 'table');
    try {
      measureApi('table-bridge', 'operation', () => {
        measureTableReference('js-to-wasm', 'table.set', () =>
          table.set(0, object)
        );
        expect(
          measureTableReference('wasm-to-js', 'table.get', () => table.get(0))
        ).toBe(object);
      });
    } finally {
      recorder.closeWindow(window, true);
      unbind();
    }
    const trace = recorder.snapshot();
    expect(validateTrace(trace)).toEqual([]);
    expect(windowMetrics(trace, window)).toMatchObject({
      apiCalls: 1,
      physicalCrossings: 0,
      abiRefSlots: 0,
      tableRefSlots: 2,
      refSlots: 2,
      referenceAccountingBytes: 16,
      bytes: 16,
    });
  });

  it('uses explicit purpose for nonfinal batches and records shared admission once', () => {
    const recorder = new AuditRecorder();
    const unbind = bindAuditRecorder(recorder, (request) => request[0] === 1);
    const key = recorder.openWindow('keystroke', 'shared-job');
    const updates: number[] = [];
    try {
      for (const label of ['first', 'second']) {
        const update = recorder.openWindow('update', label);
        withBatchPurpose('operation', () =>
          measureBatchApi('compatBatch', new Uint8Array([0]), () => 1)
        );
        withBatchPurpose('flush', () =>
          measureBatchApi('compatBatch', new Uint8Array([0]), () => 2)
        );
        recorder.closeWindow(update, true);
        updates.push(update);
      }
      measureBatchApi('compatBatch', new Uint8Array([1]), () => 3);
      // Arithmetic metadata only; production supplies the real admission receipt.
      recorder.linkCommit(7n, 9n, updates, 5);
    } finally {
      recorder.closeWindow(key, true);
      unbind();
    }
    const trace = recorder.snapshot();
    expect(validateTrace(trace)).toEqual([]);
    expect(trace.calls.map((entry) => entry.purpose)).toEqual([
      'operation',
      'flush',
      'operation',
      'flush',
      'admission',
    ]);
    expect(updates.map((id) => windowMetrics(trace, id).fixedApiCalls)).toEqual(
      [1, 1]
    );
    expect(windowMetrics(trace, key).fixedApiCalls).toBe(3);
    expect(
      validateTrace({
        ...trace,
        commitLinks: [...trace.commitLinks, trace.commitLinks[0]],
      })
    ).toEqual(['Invalid or duplicate commit link']);
    expect(validateTrace({ ...trace, commitLinks: [] })).toEqual([
      'Missing actual admission link',
    ]);
    expect(
      validateTrace({
        ...trace,
        commitLinks: trace.commitLinks.map((link) => ({
          ...link,
          updateWindowIds: [updates[0]],
        })),
      })
    ).toEqual(['Missing contributing update or explicit no-admission proof']);
  });

  it('rejects retroactive contributors and requires explicit empty/noop proof', () => {
    const recorder = new AuditRecorder();
    const key = recorder.openWindow('keystroke', 'causality');
    const first = recorder.openWindow('update', 'first');
    let call = recorder.enter('api', 'js-to-wasm', 'flush', 'fixed');
    recorder.leave(call, true);
    recorder.closeWindow(first, true);
    const admission = recorder.enter(
      'api',
      'js-to-wasm',
      'commit',
      'fixed',
      0,
      0,
      'admission'
    );
    recorder.leave(admission, true);
    const later = recorder.openWindow('update', 'later');
    call = recorder.enter('api', 'js-to-wasm', 'flush', 'fixed');
    recorder.leave(call, true);
    recorder.closeWindow(later, true);
    recorder.linkCommit(1n, 1n, [first, later], admission);
    recorder.closeWindow(key, true);
    expect(validateTrace(recorder.snapshot())).toEqual([
      'Invalid or duplicate contributing update',
    ]);
    const empty = new AuditRecorder();
    const id = empty.openWindow('update', 'empty');
    empty.closeWindow(id, true);
    expect(validateTrace(empty.snapshot())).toEqual([
      'Missing contributing update or explicit no-admission proof',
    ]);
    empty.finishWithoutAdmission(id, { kind: 'empty' });
    expect(validateTrace(empty.snapshot())).toEqual([]);
    const nonempty = new AuditRecorder();
    const update = nonempty.openWindow('update', 'not-empty');
    call = nonempty.enter(
      'api',
      'js-to-wasm',
      'EditorSession.compatFinishNoop',
      'operation'
    );
    nonempty.leave(call, true);
    nonempty.closeWindow(update, true);
    nonempty.finishWithoutAdmission(update, { kind: 'empty' });
    expect(validateTrace(nonempty.snapshot())).toEqual([
      'Empty update performed boundary work',
    ]);
    const acknowledged = new AuditRecorder();
    const noOpUpdate = acknowledged.openWindow('update', 'native-noop');
    call = acknowledged.enter(
      'api',
      'js-to-wasm',
      'EditorSession.compatFinishNoop',
      'operation'
    );
    acknowledged.leave(call, true);
    acknowledged.closeWindow(noOpUpdate, true);
    acknowledged.finishWithoutAdmission(noOpUpdate, {
      kind: 'native-noop',
      callId: call,
      result: true,
    });
    expect(validateTrace(acknowledged.snapshot())).toEqual([]);
  });
});

// Synthetic counter arithmetic fixtures only, never a native/plugin producer.
function arithmeticFixture(
  nodeCount: number,
  extraBytes = 0,
  physicalCalls = 2,
  references = 1
): FixtureMeasurements {
  const recorder = new AuditRecorder();
  const read = recorder.openWindow('read', 'read');
  recorder.closeWindow(read, true);
  const key = recorder.openWindow('keystroke', 'key');
  const update = recorder.openWindow('update', 'update');
  const api = recorder.enter('api', 'js-to-wasm', 'batch', 'fixed');
  for (let i = 0; i < physicalCalls; i++) {
    const call = recorder.enter(
      'physical',
      'js-to-wasm',
      `export${i}`,
      'operation',
      4,
      references
    );
    recorder.leave(call, true, 4);
  }
  recorder.buffer('js-to-wasm', 'payload', 100 + extraBytes);
  recorder.leave(api, true);
  recorder.closeWindow(update, true);
  const admission = recorder.enter(
    'api',
    'js-to-wasm',
    'compatCommit',
    'fixed',
    0,
    0,
    'admission'
  );
  const committed = recorder.enter(
    'physical',
    'js-to-wasm',
    'commit',
    'operation',
    4
  );
  recorder.leave(committed, true, 4);
  recorder.leave(admission, true);
  recorder.linkCommit(1n, 1n, [update], admission);
  recorder.closeWindow(key, true);
  return {
    fixtureId: `arithmetic-${nodeCount}`,
    nodeCount,
    trace: recorder.snapshot(),
    captures: {
      retainedCaptures: BigInt(nodeCount),
      liveNodes: BigInt(nodeCount),
      version: 1n,
      retirementEpoch: 1n,
    },
    gcBarrier: {
      version: 1n,
      retirementEpoch: 1n,
      finalizersCompleted: true,
      nativePruneAcknowledged: true,
      eventsRef: { path: 'arithmetic-only-not-native', sha256: '0'.repeat(64) },
    },
  };
}

describe('counter threshold arithmetic, not production acceptance', () => {
  const comparison = [
    { inputOperationHash: 'a'.repeat(64), smallWindowId: 2, largeWindowId: 2 },
  ];
  it('accepts exactly flat counters and exposes recomputed directional components', () => {
    const result = evaluateCounters(
      arithmeticFixture(10),
      arithmeticFixture(10000),
      comparison
    );
    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.windows[2].metrics.bytes).toBe(132);
  });
  it('rejects each exceeded budget and unpaired key windows without averaging', () => {
    expect(
      evaluateCounters(
        arithmeticFixture(10),
        arithmeticFixture(10000, 15),
        comparison
      ).failures
    ).toContain('Key byte growth exceeds ten percent');
    expect(
      evaluateCounters(
        arithmeticFixture(10),
        arithmeticFixture(10000, 0, 8),
        comparison
      ).failures
    ).toContain(
      'arithmetic-10000/key: physical crossings exceed four times API calls'
    );
    expect(
      evaluateCounters(
        arithmeticFixture(10),
        arithmeticFixture(10000, 0, 2, 9),
        comparison
      ).failures
    ).toContain('arithmetic-10000/key: reference slots exceed 16');
    expect(
      evaluateCounters(
        arithmeticFixture(10),
        arithmeticFixture(10000, 4096),
        comparison
      ).failures
    ).toContain('arithmetic-10000/key: bytes exceed 4096');
    expect(
      evaluateCounters(arithmeticFixture(10), arithmeticFixture(10000), []).pass
    ).toBe(false);
    const fixture = arithmeticFixture(10000);
    expect(
      evaluateCounters(
        arithmeticFixture(10),
        {
          ...fixture,
          captures: { ...fixture.captures, retainedCaptures: 20001n },
        },
        comparison
      ).failures
    ).toContain('arithmetic-10000: retained captures exceed twice live nodes');
  });

  it('rejects fixed/update, read and total-key API violations independently', () => {
    const recorder = new AuditRecorder();
    const read = recorder.openWindow('read', 'read');
    const crossed = recorder.enter(
      'api',
      'js-to-wasm',
      'read-crossing',
      'operation'
    );
    recorder.leave(crossed, true);
    recorder.closeWindow(read, true);
    const key = recorder.openWindow('keystroke', 'key');
    const update = recorder.openWindow('update', 'update');
    for (let i = 0; i < 11; i++) {
      const call = recorder.enter(
        'api',
        'js-to-wasm',
        `api${i}`,
        i < 3 ? 'fixed' : 'operation'
      );
      recorder.leave(call, true);
    }
    recorder.closeWindow(update, true);
    const admission = recorder.enter(
      'api',
      'js-to-wasm',
      'commit',
      'fixed',
      0,
      0,
      'admission'
    );
    recorder.leave(admission, true);
    recorder.linkCommit(1n, 1n, [update], admission);
    recorder.closeWindow(key, true);
    const large = arithmeticFixture(10000);
    const result = evaluateCounters(
      arithmeticFixture(10),
      { ...large, trace: recorder.snapshot() },
      comparison
    );
    expect(result.failures).toContain(
      'arithmetic-10000/read: read crossed the API boundary'
    );
    expect(result.failures).toContain(
      'arithmetic-10000/update: more than two fixed API calls'
    );
    expect(result.failures).toContain(
      'arithmetic-10000/key: more than ten API calls'
    );
  });

  it('rejects forged raw links, omitted windows, unsafe counts and mismatched source tags before totals', () => {
    const small = arithmeticFixture(10);
    const large = arithmeticFixture(10000);
    const trace = large.trace;
    expect(validateTrace(trace)).toEqual([]);
    const missingWindow = {
      ...trace,
      bytes: trace.bytes.map((entry, i) =>
        i === 0 ? { ...entry, windows: [] } : entry
      ),
    };
    expect(
      evaluateCounters(small, { ...large, trace: missingWindow }, comparison)
        .failures
    ).toContain('arithmetic-10000: Byte window/phase mismatch');
    expect(
      validateTrace({ ...trace, calls: [...trace.calls, trace.calls[0]] })
    ).toEqual(['Duplicate or invalid call ID']);
    expect(
      validateTrace({
        ...trace,
        calls: trace.calls.map((entry, i) =>
          i === 0 ? { ...entry, parentId: 999 } : entry
        ),
      })
    ).toEqual(['Call parent mismatch']);
    expect(
      validateTrace({
        ...trace,
        bytes: trace.bytes.map((entry, i) =>
          i === 0 ? { ...entry, bytes: -1 } : entry
        ),
      })
    ).toEqual(['Invalid raw byte count']);
    expect(
      validateTrace({
        ...trace,
        references: trace.references.map((entry, i) =>
          i === 0 ? { ...entry, callId: 999 } : entry
        ),
      })
    ).toEqual(['Reference slots must belong to a physical invocation']);
    expect(
      validateTrace({
        ...trace,
        bytes: trace.bytes.map((entry, i) =>
          i === 0 ? { ...entry, source: 'physical-payload-transfer' } : entry
        ),
      })
    ).toEqual(['Scalar bytes must belong to a physical invocation']);
    expect(
      validateTrace({
        ...trace,
        windows: trace.windows.map((entry, i) =>
          i === 0 ? { ...entry, closeSequence: entry.openSequence } : entry
        ),
      })
    ).toEqual(['Duplicate, missing or invalid event sequence']);
  });
});
