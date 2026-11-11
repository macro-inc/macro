import {
  CompatBatchOutcome,
  CompatBatchPhase,
  CompatBatchReply,
  CompatBatchRequest,
  CompatFailureLocation,
  CompatInstanceSeed,
  CompatNodeOperand,
  CompatOperation,
  CompatPublicationHold,
  CompatSelectionData,
  ForeignCallbackValue,
  ForeignOpaqueValue,
  type ICompatBatchReply,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { NativeBatch } from './batch';

const leases = { editorId: 1, retain: [], release: [] };
const begin = { tags: ['typing'], reserveKeys: 8, classMaskPatches: [] };
const operation = {
  operation: CompatOperation.AddUpdateTag,
  receiver: CompatNodeOperand.fromCompatNoNode({}),
  args: [],
  initialInstance: CompatInstanceSeed.fromCompatNoInstanceSeed({}),
};
const result = {
  value: ForeignCallbackValue.fromForeignOpaqueArgument({
    value: ForeignOpaqueValue.fromForeignUndefined({}),
  }),
  delta: { records: [], removedKeys: [], invalidateRootText: false },
};

// Protocol fixtures exercise queue ownership and acknowledgements, not a model
// or an initializer. Real native compact-batch acceptance remains separate.
function receipt(patch: Partial<ICompatBatchReply> = {}): Uint8Array {
  return CompatBatchReply.encode({
    updateId: 4,
    reservations: [],
    flags: 0,
    published: false,
    changed: false,
    noop: false,
    version: 7n,
    mutationEpoch: 2n,
    composition: { present: false, key: { index: 0, generation: 0 } },
    selectionBindings: [],
    selection: CompatSelectionData.fromCompatNoSelection({}),
    selections: [],
    tags: [],
    dirtyLeaves: [],
    dirtyElements: [],
    dirtyType: 0,
    delta: { records: [], removedKeys: [], invalidateRootText: false },
    results: [],
    outcome: CompatBatchOutcome.fromCompatBatchSuccess({}),
    publicationHold: CompatPublicationHold.fromCompatPublicationHoldNone({}),
    ...patch,
  }).slice();
}

test('logical begin is cold; flush and admission continue one issued native scope', () => {
  const requests: ReturnType<typeof CompatBatchRequest.decode>[] = [];
  const acknowledgements: ICompatBatchReply[] = [];
  const replies = [
    receipt({ results: [result] }),
    receipt({ mutationEpoch: 3n, published: true }),
  ];
  const batch = new NativeBatch({
    call(bytes) {
      requests.push(CompatBatchRequest.decode(bytes));
      const reply = replies.shift();
      if (!reply) throw new Error('No protocol fixture reply');
      return reply;
    },
    now: () => 10,
    wall: () => 20,
    acknowledge: (reply) => acknowledgements.push(reply),
  });
  batch.begin(6n, begin);
  expect(requests).toHaveLength(0);
  expect(batch.hasNativeScope).toBe(false);
  batch.enqueue(operation);
  const flush = batch.send(CompatBatchPhase.UpdateFlush, leases);
  expect(acknowledgements[0]).toBe(flush);
  expect(batch.hasNativeScope).toBe(true);
  expect(batch.hasOperations).toBe(false);
  const first = requests[0].scope.data;
  expect(first.discriminator).toBe(1);
  if (first.discriminator !== 1) throw new Error('Expected lazy begin');
  expect(first.value.expectedVersion).toBe(6n);
  expect(first.value.begin.tags).toEqual(['typing']);
  expect(requests[0].operations).toHaveLength(1);
  expect(requests[0].phase).toBe(CompatBatchPhase.UpdateFlush);
  const admission = batch.send(CompatBatchPhase.Admission, leases);
  expect(admission.published).toBe(true);
  const next = requests[1].scope.data;
  expect(next.discriminator).toBe(2);
  if (next.discriminator !== 2) throw new Error('Expected continuation');
  expect(next.value).toMatchObject({ updateId: 4, expectedEpoch: 2n });
  expect(requests[1].operations).toHaveLength(0);
  expect(requests[1].phase).toBe(CompatBatchPhase.Admission);
  batch.retire();
  expect(batch.hasNativeScope).toBe(false);
});

test('semantic barriers have an explicit operations phase and unknown phases do not cross', () => {
  const requests: ReturnType<typeof CompatBatchRequest.decode>[] = [];
  const batch = new NativeBatch({
    call(bytes) {
      requests.push(CompatBatchRequest.decode(bytes));
      return receipt();
    },
    now: () => 10,
    wall: () => 20,
    acknowledge: () => {},
  });
  batch.begin(6n, begin);
  expect(() => batch.send(CompatBatchPhase.Unknown, leases)).toThrow(
    'explicit execution phase'
  );
  expect(requests).toHaveLength(0);
  batch.send(CompatBatchPhase.Operations, leases);
  expect(requests[0].phase).toBe(CompatBatchPhase.Operations);
  expect(requests[0].operations).toHaveLength(0);
  expect(batch.hasNativeScope).toBe(true);
});

test('typed partial failure acknowledges effects and never retries its skipped suffix', () => {
  let request: ReturnType<typeof CompatBatchRequest.decode> | undefined;
  let acknowledged = false;
  let response = receipt({
    results: [result],
    outcome: CompatBatchOutcome.fromCompatBatchNativeFailure({
      location: CompatFailureLocation.fromCompatOperationFailure({ index: 1 }),
      errorText: [120],
    }),
  });
  const batch = new NativeBatch({
    call(bytes) {
      request = CompatBatchRequest.decode(bytes);
      return response;
    },
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      acknowledged = true;
    },
  });
  batch.begin(6n, begin);
  batch.enqueue(operation);
  batch.enqueue(operation);
  batch.enqueue(operation);
  const failed = batch.send(CompatBatchPhase.Operations, leases);
  expect(failed.outcome.data.discriminator).toBe(2);
  expect(acknowledged).toBe(true);
  response = receipt();
  batch.send(CompatBatchPhase.Operations, leases);
  expect(request?.operations).toHaveLength(0);
});

test('invalid admission during flush cannot be retried before native discard', () => {
  let calls = 0;
  const batch = new NativeBatch({
    call() {
      calls++;
      return receipt({ published: true });
    },
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      throw new Error('Invalid receipt must not be acknowledged');
    },
  });
  batch.begin(6n, begin);
  expect(() => batch.send(CompatBatchPhase.Operations, leases)).toThrow(
    'cannot admit'
  );
  expect(() => batch.send(CompatBatchPhase.Operations, leases)).toThrow(
    'Discard'
  );
  expect(calls).toBe(1);
  batch.retire();
  batch.begin(6n, begin);
  expect(batch.hasNativeScope).toBe(false);
});

test('operations and update flush cannot retire a scope as a no-op', () => {
  for (const phase of [
    CompatBatchPhase.Operations,
    CompatBatchPhase.UpdateFlush,
  ]) {
    const batch = new NativeBatch({
      call: () => receipt({ noop: true, version: 6n }),
      now: () => 0,
      wall: () => 0,
      acknowledge() {
        throw new Error('Invalid retirement must not be acknowledged');
      },
    });
    batch.begin(6n, begin);
    expect(() => batch.send(phase, leases)).toThrow('cannot admit or retire');
  }
});

test('malformed failure prefix rejects before applying any reply', () => {
  const batch = new NativeBatch({
    call: () =>
      receipt({
        outcome: CompatBatchOutcome.fromCompatBatchNativeFailure({
          location: CompatFailureLocation.fromCompatOperationFailure({
            index: 1,
          }),
          errorText: [],
        }),
      }),
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      throw new Error('Invalid prefix must not be applied');
    },
  });
  batch.begin(6n, begin);
  batch.enqueue(operation);
  expect(() => batch.send(CompatBatchPhase.Operations, leases)).toThrow(
    'invalid prefix'
  );
});

test('acknowledgement failure preserves the original error and requires discard', () => {
  const error = {};
  const batch = new NativeBatch({
    call: () => receipt(),
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      throw error;
    },
  });
  batch.begin(6n, begin);
  let observed: unknown;
  try {
    batch.send(CompatBatchPhase.Operations, leases);
  } catch (caught) {
    observed = caught;
  }
  expect(observed).toBe(error);
  expect(() => batch.enqueue(operation)).toThrow('Discard');
});

test('scoped callbacks cannot recursively enter or mutate the session batch', () => {
  let calls = 0;
  const batch = new NativeBatch({
    call() {
      calls++;
      expect(() => batch.send(CompatBatchPhase.Operations, leases)).toThrow(
        'scoped callback'
      );
      expect(() => batch.enqueue(operation)).toThrow('scoped callback');
      expect(() => batch.retire()).toThrow('during its call');
      return receipt();
    },
    now: () => 0,
    wall: () => 0,
    acknowledge() {},
  });
  batch.begin(6n, begin);
  batch.send(CompatBatchPhase.Operations, leases);
  expect(calls).toBe(1);
  expect(batch.hasOperations).toBe(false);
});

test('terminal success requires exactly publication or explicit no-op retirement', () => {
  let response = receipt({ published: true, noop: true });
  const batch = new NativeBatch({
    call: () => response,
    now: () => 0,
    wall: () => 0,
    acknowledge() {},
  });
  batch.begin(6n, begin);
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'both publish'
  );
  batch.retire();
  batch.begin(6n, begin);
  response = receipt();
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'did not publish or retire'
  );
});

test('actual publication is acknowledged before returning a finalization failure', () => {
  let acknowledged: ICompatBatchReply | undefined;
  let calls = 0;
  const batch = new NativeBatch({
    call() {
      calls++;
      return receipt({
        published: true,
        changed: true,
        results: [result],
        outcome: CompatBatchOutcome.fromCompatBatchNativeFailure({
          location: CompatFailureLocation.fromCompatFinalizeFailure({}),
          errorText: [118, 105, 101, 119],
        }),
      });
    },
    now: () => 0,
    wall: () => 0,
    acknowledge(reply) {
      acknowledged = reply;
    },
  });
  batch.begin(6n, begin);
  batch.enqueue(operation);
  const reply = batch.send(CompatBatchPhase.Admission, leases);
  expect(acknowledged).toBe(reply);
  expect(reply.published).toBe(true);
  expect(reply.outcome.data.discriminator).toBe(2);
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'already retired'
  );
  expect(() => batch.enqueue(operation)).toThrow('already retired');
  expect(calls).toBe(1);
  batch.retire();
});

test('no-op retires the issued scope onto the actual committed version including zero', () => {
  const replies = [
    receipt(),
    receipt({ noop: true, version: 0n, mutationEpoch: 3n }),
  ];
  let acknowledged: ICompatBatchReply | undefined;
  const batch = new NativeBatch({
    call() {
      const reply = replies.shift();
      if (reply === undefined) throw new Error('Missing protocol receipt');
      return reply;
    },
    now: () => 0,
    wall: () => 0,
    acknowledge(reply) {
      acknowledged = reply;
    },
  });
  batch.begin(0n, begin);
  batch.send(CompatBatchPhase.Operations, leases);
  const reply = batch.send(CompatBatchPhase.Admission, leases);
  expect(reply.version).toBe(0n);
  expect(reply.updateId).toBe(4);
  expect(acknowledged).toBe(reply);
  expect(() => batch.send(CompatBatchPhase.Operations, leases)).toThrow(
    'already retired'
  );
  batch.retire();
  batch.begin(0n, begin);
  expect(batch.hasNativeScope).toBe(false);
});

test('publication cannot disguise an operation failure or a different no-op graph', () => {
  let response = receipt({
    published: true,
    outcome: CompatBatchOutcome.fromCompatBatchNativeFailure({
      location: CompatFailureLocation.fromCompatOperationFailure({ index: 0 }),
      errorText: [],
    }),
  });
  const batch = new NativeBatch({
    call: () => response,
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      throw new Error('Invalid receipt must not be applied');
    },
  });
  batch.begin(6n, begin);
  batch.enqueue(operation);
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'Only finalization failure'
  );
  batch.retire();
  batch.begin(6n, begin);
  response = receipt({ noop: true, version: 5n });
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'committed graph version'
  );
});

test('first normalization and publication receipts must issue a newer pending version', () => {
  for (const version of [5n, 6n]) {
    for (const phase of [
      CompatBatchPhase.Operations,
      CompatBatchPhase.UpdateFlush,
      CompatBatchPhase.Admission,
    ]) {
      const batch = new NativeBatch({
        call: () =>
          receipt({ version, published: phase === CompatBatchPhase.Admission }),
        now: () => 0,
        wall: () => 0,
        acknowledge() {
          throw new Error('Stale receipt must not be applied');
        },
      });
      batch.begin(6n, begin);
      expect(() => batch.send(phase, leases)).toThrow('newer pending version');
    }
  }
});

test('failed publication acknowledgement cannot be recovered by pretending to discard', () => {
  const failure = {};
  const batch = new NativeBatch({
    call: () => receipt({ published: true }),
    now: () => 0,
    wall: () => 0,
    acknowledge() {
      throw failure;
    },
  });
  batch.begin(6n, begin);
  let observed: unknown;
  try {
    batch.send(CompatBatchPhase.Admission, leases);
  } catch (error) {
    observed = error;
  }
  expect(observed).toBe(failure);
  expect(() => batch.send(CompatBatchPhase.Admission, leases)).toThrow(
    'dispose the editor'
  );
  expect(() => batch.retire()).toThrow('dispose the editor');
  expect(() => batch.begin(7n, begin)).toThrow('dispose the editor');
});
