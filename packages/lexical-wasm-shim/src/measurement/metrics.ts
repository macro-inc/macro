export type Direction = 'js-to-wasm' | 'wasm-to-js';
export type Layer = 'api' | 'physical';
export type WindowKind = 'update' | 'read' | 'keystroke' | 'diagnostic';
export type CallCategory = 'fixed' | 'operation';
export type ApiPurpose = 'flush' | 'admission' | 'operation';
export type MeasurementPhase = 'setup' | 'measurement' | 'gc' | 'diagnostic';

export interface CallRecord {
  readonly id: number;
  readonly enterSequence: number;
  readonly leaveSequence: number;
  readonly parentId: number | null;
  readonly windows: readonly number[];
  readonly layer: Layer;
  readonly direction: Direction;
  readonly method: string;
  readonly category: CallCategory;
  readonly purpose: ApiPurpose;
  readonly phase: MeasurementPhase;
  readonly completed: boolean;
}
export interface ByteRecord {
  readonly sequence: number;
  /** Enclosing invocation, including an API parent between physical entries. */
  readonly callId: number | null;
  readonly windows: readonly number[];
  readonly direction: Direction;
  readonly kind: 'scalar' | 'buffer';
  readonly method: string;
  readonly bytes: number;
  readonly phase: MeasurementPhase;
  readonly source: 'physical-scalar' | 'physical-payload-transfer';
}
export interface WindowRecord {
  readonly id: number;
  readonly openSequence: number;
  readonly closeSequence: number;
  readonly parentId: number | null;
  readonly kind: WindowKind;
  readonly label: string;
  readonly phase: MeasurementPhase;
  readonly completed: boolean;
}
export interface ReferenceRecord {
  readonly sequence: number;
  readonly callId: number | null;
  readonly windows: readonly number[];
  readonly direction: Direction;
  readonly method: string;
  readonly slots: number;
  readonly phase: MeasurementPhase;
  readonly source: 'physical-reference' | 'physical-reference-table';
}
export interface AuditTrace {
  readonly schemaVersion: 1;
  readonly calls: readonly CallRecord[];
  readonly bytes: readonly ByteRecord[];
  readonly windows: readonly WindowRecord[];
  readonly references: readonly ReferenceRecord[];
  readonly phases: readonly {
    readonly sequence: number;
    readonly phase: Exclude<MeasurementPhase, 'measurement'>;
  }[];
  readonly issues: readonly string[];
  readonly commitLinks: readonly CommitLink[];
  readonly noAdmissions: readonly NoAdmission[];
}
export type NoAdmissionProof =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'native-noop';
      readonly callId: number;
      readonly result: true;
    }
  | {
      readonly kind: 'batch-noop';
      readonly callId: number;
      readonly success: true;
      readonly noop: true;
      readonly published: false;
    }
  | {
      readonly kind: 'discarded';
      readonly callId: number;
      readonly ownsPendingWindow: true;
    };
export interface NoAdmission {
  readonly updateWindowId: number;
  readonly proof: NoAdmissionProof;
  readonly linkedAfterSequence: number;
}
export interface CommitLink {
  readonly commitId: string;
  readonly version: string;
  readonly updateWindowIds: readonly number[];
  readonly admissionCallId: number;
  readonly linkedAfterSequence: number;
}
interface PendingCall extends Omit<CallRecord, 'completed' | 'leaveSequence'> {}
interface PendingWindow
  extends Omit<WindowRecord, 'completed' | 'closeSequence'> {
  readonly callDepth: number;
}

function count(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Measurement count must be a nonnegative safe integer');
}
function name(value: string): void {
  if (value.length === 0) throw new Error('Measurement name is empty');
}
function opposite(direction: Direction): Direction {
  return direction === 'js-to-wasm' ? 'wasm-to-js' : 'js-to-wasm';
}

/** Opt-in collector. Production code never constructs or calls it when disabled. */
export class AuditRecorder {
  private readonly calls: CallRecord[] = [];
  private readonly byteRecords: ByteRecord[] = [];
  private readonly windows: WindowRecord[] = [];
  private readonly references: ReferenceRecord[] = [];
  private readonly phases: {
    readonly sequence: number;
    readonly phase: Exclude<MeasurementPhase, 'measurement'>;
  }[] = [Object.freeze({ sequence: 1, phase: 'setup' })];
  private readonly issues: string[] = [];
  private readonly commitLinks: CommitLink[] = [];
  private readonly noAdmissions: NoAdmission[] = [];
  private readonly callStack: PendingCall[] = [];
  private readonly windowStack: PendingWindow[] = [];
  private nextCall = 1;
  private nextWindow = 1;
  private nextSequence = 2;
  private invalid = false;
  private phase: MeasurementPhase = 'setup';

  private reject(message: string): never {
    this.invalid = true;
    throw new Error(message);
  }

  private checkCount(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      this.reject('Measurement count must be a nonnegative safe integer');
  }

  noteBatchClassificationFailure(): void {
    this.issues.push('Generated compatBatch request could not be classified');
  }

  classifyCall(id: number, purpose: ApiPurpose): void {
    const call = this.callStack.at(-1);
    if (call?.id !== id || call.layer !== 'api')
      this.reject('No owning API invocation to classify');
    this.callStack[this.callStack.length - 1] = {
      ...call,
      purpose,
      category: purpose === 'operation' ? 'operation' : 'fixed',
    };
  }

  /** Called only after the real admission receipt, never inferred from scheduling. */
  linkCommit(
    commitId: bigint,
    version: bigint,
    updateWindowIds: readonly number[],
    admissionCallId: number
  ): void {
    if (commitId < 0n || version < 0n)
      this.reject('Invalid native admission identity');
    this.commitLinks.push(
      Object.freeze({
        commitId: commitId.toString(),
        version: version.toString(),
        updateWindowIds: Object.freeze([...updateWindowIds]),
        admissionCallId,
        linkedAfterSequence: this.nextSequence - 1,
      })
    );
  }

  setPhase(phase: Exclude<MeasurementPhase, 'measurement'>): void {
    if (this.callStack.length !== 0 || this.windowStack.length !== 0)
      this.reject('Cannot change measurement phase during a call or window');
    this.phase = phase;
    this.phases.push(Object.freeze({ sequence: this.nextSequence++, phase }));
  }

  private currentPhase(): MeasurementPhase {
    return this.windowStack.at(-1)?.phase ?? this.phase;
  }

  finishWithoutAdmission(
    updateWindowId: number,
    proof: NoAdmissionProof
  ): void {
    this.noAdmissions.push(
      Object.freeze({
        updateWindowId,
        proof: Object.freeze({ ...proof }),
        linkedAfterSequence: this.nextSequence - 1,
      })
    );
  }

  get hasOpenWindow(): boolean {
    return this.windowStack.length !== 0;
  }

  openWindow(kind: WindowKind, label: string): number {
    name(label);
    const parent = this.windowStack.at(-1);
    if (kind === 'keystroke' && parent !== undefined)
      return this.reject('Keystroke windows cannot overlap');
    if (kind === 'update' && parent?.kind === 'read')
      return this.reject('Cannot measure an update inside a read');
    const id = this.nextWindow++;
    this.windowStack.push({
      id,
      openSequence: this.nextSequence++,
      parentId: parent?.id ?? null,
      kind,
      phase:
        kind === 'diagnostic' || parent?.phase === 'diagnostic'
          ? 'diagnostic'
          : 'measurement',
      label,
      callDepth: this.callStack.length,
    });
    return id;
  }

  closeWindow(id: number, completed: boolean): void {
    const window = this.windowStack.at(-1);
    if (window?.id !== id || this.callStack.length !== window.callDepth)
      this.reject(
        'Measurement windows must close in order after boundary calls'
      );
    this.windowStack.pop();
    this.windows.push(
      Object.freeze({
        id: window.id,
        openSequence: window.openSequence,
        closeSequence: this.nextSequence++,
        parentId: window.parentId,
        kind: window.kind,
        label: window.label,
        phase: window.phase,
        completed,
      })
    );
  }

  /** Record an entry once; returns add bytes but never another entry. */
  enter(
    layer: Layer,
    direction: Direction,
    method: string,
    category: CallCategory,
    scalarInputBytes = 0,
    referenceInputSlots = 0,
    purpose: ApiPurpose = category === 'fixed' ? 'flush' : 'operation'
  ): number {
    name(method);
    this.checkCount(scalarInputBytes);
    this.checkCount(referenceInputSlots);
    if (
      layer === 'api' &&
      (scalarInputBytes !== 0 || referenceInputSlots !== 0)
    )
      return this.reject('Count scalar ABI bytes at physical entries only');
    const call: PendingCall = {
      id: this.nextCall++,
      enterSequence: this.nextSequence++,
      parentId: this.callStack.at(-1)?.id ?? null,
      windows: Object.freeze(this.windowStack.map((window) => window.id)),
      layer,
      direction,
      method,
      category,
      purpose,
      phase: this.currentPhase(),
    };
    this.callStack.push(call);
    if (scalarInputBytes > 0)
      this.recordBytes(direction, 'scalar', method, scalarInputBytes);
    if (referenceInputSlots > 0)
      this.recordReferences(call, direction, referenceInputSlots);
    return call.id;
  }

  leave(
    id: number,
    completed: boolean,
    scalarOutputBytes = 0,
    referenceOutputSlots = 0
  ): void {
    this.checkCount(scalarOutputBytes);
    this.checkCount(referenceOutputSlots);
    const call = this.callStack.at(-1);
    if (call?.id !== id)
      this.reject('Boundary calls must return in entry order');
    if (
      call.layer === 'api' &&
      (scalarOutputBytes !== 0 || referenceOutputSlots !== 0)
    )
      this.reject('Count scalar ABI bytes at physical returns only');
    if (scalarOutputBytes > 0)
      this.recordBytes(
        opposite(call.direction),
        'scalar',
        call.method,
        scalarOutputBytes
      );
    if (referenceOutputSlots > 0)
      this.recordReferences(
        call,
        opposite(call.direction),
        referenceOutputSlots
      );
    this.callStack.pop();
    this.calls.push(
      Object.freeze({ ...call, completed, leaveSequence: this.nextSequence++ })
    );
  }

  private recordReferences(
    call: PendingCall,
    direction: Direction,
    slots: number
  ): void {
    this.references.push(
      Object.freeze({
        sequence: this.nextSequence++,
        callId: call.id,
        windows: call.windows,
        direction,
        method: call.method,
        slots,
        phase: this.currentPhase(),
        source: 'physical-reference',
      })
    );
  }

  tableReference(direction: Direction, method: string): void {
    name(method);
    this.references.push(
      Object.freeze({
        sequence: this.nextSequence++,
        callId: this.callStack.at(-1)?.id ?? null,
        windows: Object.freeze(this.windowStack.map((window) => window.id)),
        direction,
        method,
        slots: 1,
        phase: this.currentPhase(),
        source: 'physical-reference-table',
      })
    );
  }

  /** Buffer payload transfers, not pointer/length scalar slots or allocator capacity. */
  buffer(direction: Direction, method: string, bytes: number): void {
    name(method);
    this.checkCount(bytes);
    this.recordBytes(direction, 'buffer', method, bytes);
  }

  private recordBytes(
    direction: Direction,
    kind: ByteRecord['kind'],
    method: string,
    bytes: number
  ): void {
    this.byteRecords.push(
      Object.freeze({
        sequence: this.nextSequence++,
        callId: this.callStack.at(-1)?.id ?? null,
        windows: Object.freeze(this.windowStack.map((window) => window.id)),
        direction,
        kind,
        method,
        bytes,
        phase: this.currentPhase(),
        source:
          kind === 'scalar' ? 'physical-scalar' : 'physical-payload-transfer',
      })
    );
  }

  snapshot(): AuditTrace {
    if (
      this.invalid ||
      this.callStack.length !== 0 ||
      this.windowStack.length !== 0
    )
      throw new Error('Measurement trace is invalid or unfinished');
    return Object.freeze({
      schemaVersion: 1,
      calls: Object.freeze([...this.calls].sort((a, b) => a.id - b.id)),
      bytes: Object.freeze([...this.byteRecords]),
      windows: Object.freeze([...this.windows].sort((a, b) => a.id - b.id)),
      references: Object.freeze([...this.references]),
      phases: Object.freeze([...this.phases]),
      issues: Object.freeze([...this.issues]),
      commitLinks: Object.freeze([...this.commitLinks]),
      noAdmissions: Object.freeze([...this.noAdmissions]),
    });
  }
}

export interface WindowMetrics {
  readonly apiCalls: number;
  readonly fixedApiCalls: number;
  readonly physicalCrossings: number;
  readonly bytes: number;
  readonly numericAbiBytes: number;
  readonly bufferPayloadBytes: number;
  readonly refSlots: number;
  readonly abiRefSlots: number;
  readonly tableRefSlots: number;
  /** Accounting charge, not an ABI width. */
  readonly referenceAccountingBytes: number;
  readonly jsToWasmRefSlots: number;
  readonly wasmToJsRefSlots: number;
  readonly jsToWasmScalarBytes: number;
  readonly wasmToJsScalarBytes: number;
  readonly jsToWasmBufferBytes: number;
  readonly wasmToJsBufferBytes: number;
  readonly completed: boolean;
}

/** Recompute all totals from raw records; nested windows never double count. */
export function windowMetrics(trace: AuditTrace, id: number): WindowMetrics {
  const window = trace.windows.find((entry) => entry.id === id);
  if (window === undefined) throw new Error('Unknown measurement window');
  let apiCalls = 0;
  let fixedApiCalls = 0;
  let physicalCrossings = 0;
  let completed = window.completed && trace.issues.length === 0;
  for (const call of trace.calls) {
    if (!call.windows.includes(id)) continue;
    completed &&= call.completed;
    if (call.layer === 'physical') physicalCrossings++;
    else {
      apiCalls++;
      if (call.category === 'fixed') fixedApiCalls++;
    }
  }
  let jsToWasmScalarBytes = 0;
  let wasmToJsScalarBytes = 0;
  let jsToWasmBufferBytes = 0;
  let wasmToJsBufferBytes = 0;
  for (const entry of trace.bytes) {
    if (!entry.windows.includes(id)) continue;
    if (entry.direction === 'js-to-wasm') {
      if (entry.kind === 'scalar') jsToWasmScalarBytes += entry.bytes;
      else jsToWasmBufferBytes += entry.bytes;
    } else if (entry.kind === 'scalar') wasmToJsScalarBytes += entry.bytes;
    else wasmToJsBufferBytes += entry.bytes;
  }
  let jsToWasmRefSlots = 0;
  let wasmToJsRefSlots = 0;
  let abiRefSlots = 0;
  let tableRefSlots = 0;
  for (const entry of trace.references) {
    if (!entry.windows.includes(id)) continue;
    if (entry.direction === 'js-to-wasm') jsToWasmRefSlots += entry.slots;
    else wasmToJsRefSlots += entry.slots;
    if (entry.source === 'physical-reference') abiRefSlots += entry.slots;
    else tableRefSlots += entry.slots;
  }
  const refSlots = jsToWasmRefSlots + wasmToJsRefSlots;
  const referenceAccountingBytes = 8 * refSlots;
  const numericAbiBytes = jsToWasmScalarBytes + wasmToJsScalarBytes;
  const bufferPayloadBytes = jsToWasmBufferBytes + wasmToJsBufferBytes;
  const bytes = numericAbiBytes + bufferPayloadBytes + referenceAccountingBytes;
  count(bytes);
  return Object.freeze({
    apiCalls,
    fixedApiCalls,
    physicalCrossings,
    bytes,
    numericAbiBytes,
    bufferPayloadBytes,
    refSlots,
    abiRefSlots,
    tableRefSlots,
    referenceAccountingBytes,
    jsToWasmRefSlots,
    wasmToJsRefSlots,
    jsToWasmScalarBytes,
    wasmToJsScalarBytes,
    jsToWasmBufferBytes,
    wasmToJsBufferBytes,
    completed,
  });
}
