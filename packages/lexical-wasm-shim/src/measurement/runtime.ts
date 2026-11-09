import type {
  ApiPurpose,
  AuditRecorder,
  CallCategory,
  Direction,
  WindowKind,
} from './metrics';

let recorder: AuditRecorder | undefined;
let classifyBatch: ((request: Uint8Array) => boolean) | undefined;
let batchPurpose: ApiPurpose | undefined;

/** Diagnostic entry only; no editor/session/root is retained by the collector. */
export function bindAuditRecorder(
  next: AuditRecorder,
  batchFinalizes: (request: Uint8Array) => boolean
): () => void {
  if (recorder !== undefined)
    throw new Error('An audit recorder is already bound');
  recorder = next;
  classifyBatch = batchFinalizes;
  return () => {
    if (recorder !== next) throw new Error('Audit recorder binding changed');
    recorder = undefined;
    classifyBatch = undefined;
    batchPurpose = undefined;
  };
}

export function currentAuditRecorder(): AuditRecorder {
  if (recorder === undefined)
    throw new Error('Diagnostic glue requires an audit recorder');
  return recorder;
}

export function withBatchPurpose<T>(purpose: ApiPurpose, body: () => T): T {
  const previous = batchPurpose;
  batchPurpose = purpose;
  try {
    return body();
  } finally {
    batchPurpose = previous;
  }
}

export function measureBatchApi<T>(
  method: string,
  request: Uint8Array,
  body: () => T
): T {
  const owner = currentAuditRecorder();
  const id = owner.enter('api', 'js-to-wasm', method, 'operation');
  const hint = batchPurpose;
  batchPurpose = undefined;
  let completed = false;
  try {
    try {
      if (classifyBatch === undefined)
        throw new Error('Missing generated batch decoder');
      const admission = classifyBatch(request);
      if (admission) {
        if (hint !== undefined && hint !== 'admission')
          owner.noteBatchClassificationFailure();
        owner.classifyCall(id, 'admission');
      } else if (hint === 'operation' || hint === 'flush')
        owner.classifyCall(id, hint);
      else owner.noteBatchClassificationFailure();
    } catch {
      owner.noteBatchClassificationFailure();
    }
    const value = body();
    completed = true;
    return value;
  } finally {
    owner.leave(id, completed);
  }
}

export function measureMemoryWrite<T>(
  method: string,
  bytes: number,
  body: () => T
): T {
  const value = body();
  measureBuffer('js-to-wasm', method, bytes);
  return value;
}

export function measureTableReference<T>(
  direction: Direction,
  method: string,
  body: () => T
): T {
  const value = body();
  currentAuditRecorder().tableReference(direction, method);
  return value;
}

export function measureApi<T>(
  method: string,
  category: CallCategory,
  body: () => T
): T {
  const owner = currentAuditRecorder();
  const purpose =
    category === 'operation'
      ? 'operation'
      : method.endsWith('.compatCommit')
        ? 'admission'
        : 'flush';
  const id = owner.enter('api', 'js-to-wasm', method, category, 0, 0, purpose);
  let completed = false;
  try {
    const value = body();
    completed = true;
    return value;
  } finally {
    owner.leave(id, completed);
  }
}

/** Widths come from the exact module's disassembled signatures, never JS typeof. */
export function measurePhysical<T>(
  method: string,
  direction: Direction,
  inputNumericBytes: number,
  outputNumericBytes: number,
  inputRefSlots: number,
  outputRefSlots: number,
  body: () => T
): T {
  const owner = currentAuditRecorder();
  const id = owner.enter(
    'physical',
    direction,
    method,
    'operation',
    inputNumericBytes,
    inputRefSlots
  );
  let completed = false;
  try {
    const value = body();
    completed = true;
    return value;
  } finally {
    owner.leave(
      id,
      completed,
      completed ? outputNumericBytes : 0,
      completed ? outputRefSlots : 0
    );
  }
}

export function measureBuffer(
  direction: Direction,
  method: string,
  bytes: number
): void {
  currentAuditRecorder().buffer(direction, method, bytes);
}

/** Synchronous callback scope; deferred commits use explicit open/close windows. */
export function measureWindow<T>(
  kind: WindowKind,
  label: string,
  body: () => T
): T {
  const owner = currentAuditRecorder();
  const id = owner.openWindow(kind, label);
  let completed = false;
  try {
    const value = body();
    completed = true;
    return value;
  } finally {
    owner.closeWindow(id, completed);
  }
}
