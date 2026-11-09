import type {
  AuditTrace,
  ByteRecord,
  CallRecord,
  MeasurementPhase,
  ReferenceRecord,
  WindowRecord,
} from './metrics';

type Event =
  | {
      readonly sequence: number;
      readonly kind: 'enter' | 'leave';
      readonly call: CallRecord;
    }
  | {
      readonly sequence: number;
      readonly kind: 'open' | 'close';
      readonly window: WindowRecord;
    }
  | {
      readonly sequence: number;
      readonly kind: 'bytes';
      readonly bytes: ByteRecord;
    }
  | {
      readonly sequence: number;
      readonly kind: 'references';
      readonly references: ReferenceRecord;
    }
  | {
      readonly sequence: number;
      readonly kind: 'phase';
      readonly phase: MeasurementPhase;
    };

function nonnegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function positive(value: number): boolean {
  return nonnegative(value) && value > 0;
}
function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
function named(value: string): boolean {
  return typeof value === 'string' && value.length > 0;
}
function direction(value: string): boolean {
  return value === 'js-to-wasm' || value === 'wasm-to-js';
}

/** Replay event order so omitted window attribution cannot turn an expensive read/key into zero. */
export function validateTrace(trace: AuditTrace): readonly string[] {
  if (trace.schemaVersion !== 1) return ['Unknown measurement trace version'];
  if (trace.issues.length > 0) return ['Unclassified boundary observation'];
  const events: Event[] = [];
  const ids = new Set<number>();
  for (const call of trace.calls) {
    if (!positive(call.id) || ids.has(call.id))
      return ['Duplicate or invalid call ID'];
    ids.add(call.id);
    if (
      !named(call.method) ||
      !direction(call.direction) ||
      typeof call.completed !== 'boolean' ||
      (call.category !== 'fixed' && call.category !== 'operation') ||
      (call.layer !== 'api' && call.layer !== 'physical')
    )
      return ['Invalid boundary entry'];
    if (
      !['operation', 'flush', 'admission'].includes(call.purpose) ||
      (call.category === 'operation') !== (call.purpose === 'operation') ||
      (call.layer === 'physical' && call.purpose !== 'operation')
    )
      return ['Invalid API purpose'];
    events.push(
      { sequence: call.enterSequence, kind: 'enter', call },
      { sequence: call.leaveSequence, kind: 'leave', call }
    );
  }
  ids.clear();
  for (const window of trace.windows) {
    if (!positive(window.id) || ids.has(window.id))
      return ['Duplicate or invalid window ID'];
    ids.add(window.id);
    if (
      !named(window.label) ||
      typeof window.completed !== 'boolean' ||
      !['update', 'read', 'keystroke', 'diagnostic'].includes(window.kind)
    )
      return ['Invalid measurement window'];
    events.push(
      { sequence: window.openSequence, kind: 'open', window },
      { sequence: window.closeSequence, kind: 'close', window }
    );
  }
  for (const bytes of trace.bytes)
    events.push({ sequence: bytes.sequence, kind: 'bytes', bytes });
  for (const references of trace.references)
    events.push({
      sequence: references.sequence,
      kind: 'references',
      references,
    });
  for (const phase of trace.phases)
    events.push({
      sequence: phase.sequence,
      kind: 'phase',
      phase: phase.phase,
    });
  events.sort((a, b) => a.sequence - b.sequence);
  if (events[0]?.kind !== 'phase' || events[0].phase !== 'setup')
    return ['Missing initial setup phase'];
  const replay = new TraceReplay();
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.sequence !== i + 1)
      return ['Duplicate, missing or invalid event sequence'];
    const error = replay.accept(event);
    if (error !== null) return [error];
  }
  if (!replay.finished()) return ['Unfinished call or window'];
  return validateCommitLinks(trace, events.length);
}

function validateCommitLinks(
  trace: AuditTrace,
  lastSequence: number
): readonly string[] {
  const admitted = new Set<number>();
  const commits = new Set<string>();
  const updates = new Set<number>();
  const callMap = new Map(trace.calls.map((call) => [call.id, call]));
  const windowMap = new Map(trace.windows.map((window) => [window.id, window]));
  for (const link of trace.commitLinks) {
    if (
      !/^(?:0|[1-9]\d*)$/.test(link.version) ||
      !/^(?:0|[1-9]\d*)$/.test(link.commitId) ||
      !positive(link.linkedAfterSequence) ||
      link.linkedAfterSequence > lastSequence ||
      commits.has(link.commitId) ||
      admitted.has(link.admissionCallId)
    )
      return ['Invalid or duplicate commit link'];
    const call = callMap.get(link.admissionCallId);
    if (
      call?.layer !== 'api' ||
      call.purpose !== 'admission' ||
      !call.completed ||
      call.leaveSequence > link.linkedAfterSequence
    )
      return ['Commit link precedes actual admission receipt'];
    if (link.updateWindowIds.length === 0 && call.phase === 'measurement')
      return ['Missing contributing updates'];
    for (const id of link.updateWindowIds) {
      const window = windowMap.get(id);
      if (
        window?.kind !== 'update' ||
        !window.completed ||
        window.closeSequence >= call.enterSequence ||
        updates.has(id)
      )
        return ['Invalid or duplicate contributing update'];
      updates.add(id);
    }
    admitted.add(link.admissionCallId);
    commits.add(link.commitId);
  }
  if (
    trace.calls.some(
      (call) =>
        call.purpose === 'admission' &&
        call.phase === 'measurement' &&
        call.completed &&
        !admitted.has(call.id)
    )
  )
    return ['Missing actual admission link'];
  const noAdmissionErrors = validateNoAdmissions(trace, updates, lastSequence);
  if (noAdmissionErrors.length > 0) return noAdmissionErrors;
  if (
    trace.windows.some(
      (window) =>
        window.kind === 'update' &&
        window.phase === 'measurement' &&
        window.completed &&
        !updates.has(window.id)
    )
  )
    return ['Missing contributing update or explicit no-admission proof'];

  return [];
}

function validateNoAdmissions(
  trace: AuditTrace,
  accounted: Set<number>,
  lastSequence: number
): readonly string[] {
  const windows = new Map(trace.windows.map((window) => [window.id, window]));
  const calls = new Map(trace.calls.map((call) => [call.id, call]));
  for (const entry of trace.noAdmissions) {
    const window = windows.get(entry.updateWindowId);
    if (
      window?.kind !== 'update' ||
      accounted.has(window.id) ||
      !positive(entry.linkedAfterSequence) ||
      entry.linkedAfterSequence > lastSequence ||
      window.closeSequence > entry.linkedAfterSequence
    )
      return ['Invalid or duplicate no-admission proof'];
    const proof = entry.proof;
    if (proof.kind === 'empty') {
      if (
        !window.completed ||
        trace.calls.some((call) => call.windows.includes(window.id)) ||
        trace.bytes.some((bytes) => bytes.windows.includes(window.id)) ||
        trace.references.some((refs) => refs.windows.includes(window.id))
      )
        return ['Empty update performed boundary work'];
    } else {
      const call = calls.get(proof.callId);
      if (
        call?.layer !== 'api' ||
        !call.completed ||
        call.purpose === 'admission' ||
        call.enterSequence < window.openSequence ||
        call.leaveSequence > entry.linkedAfterSequence
      )
        return ['No-admission proof has no matching native acknowledgement'];
      const nativeNoop =
        proof.kind === 'native-noop' &&
        proof.result === true &&
        call.method.endsWith('.compatFinishNoop');
      const batchNoop =
        proof.kind === 'batch-noop' &&
        proof.success === true &&
        proof.noop === true &&
        proof.published === false &&
        call.method.endsWith('.compatBatch');
      const discarded =
        proof.kind === 'discarded' &&
        proof.ownsPendingWindow === true &&
        call.method.endsWith('.compatDiscard');
      if (!nativeNoop && !batchNoop && !discarded)
        return ['Unsupported no-admission acknowledgement'];
    }
    accounted.add(window.id);
  }
  return [];
}

class TraceReplay {
  private readonly calls: CallRecord[] = [];
  private readonly windows: {
    readonly window: WindowRecord;
    readonly callDepth: number;
  }[] = [];
  private phase: MeasurementPhase = 'setup';

  finished(): boolean {
    return this.calls.length === 0 && this.windows.length === 0;
  }
  private windowIds(): number[] {
    return this.windows.map((entry) => entry.window.id);
  }
  private currentPhase(): MeasurementPhase {
    return this.windows.at(-1)?.window.phase ?? this.phase;
  }

  accept(event: Event): string | null {
    if (event.kind === 'phase') {
      if (
        !this.finished() ||
        !['setup', 'gc', 'diagnostic'].includes(event.phase)
      )
        return 'Invalid phase change';
      this.phase = event.phase;
      return null;
    }
    if (event.kind === 'open' || event.kind === 'close')
      return this.window(event);
    if (event.kind === 'enter' || event.kind === 'leave')
      return this.call(event);
    if (event.kind === 'bytes') return this.bytes(event.bytes);
    if (event.kind === 'references') return this.references(event.references);
    return 'Unknown measurement event';
  }

  private window(
    event: Extract<Event, { readonly kind: 'open' | 'close' }>
  ): string | null {
    const value = event.window;
    const previous = this.windows.at(-1);
    if (event.kind === 'open') {
      if (value.parentId !== (previous?.window.id ?? null))
        return 'Window parent mismatch';
      if (value.kind === 'keystroke' && previous !== undefined)
        return 'Overlapping key windows';
      if (value.kind === 'update' && previous?.window.kind === 'read')
        return 'Update inside read window';
      const expectedPhase =
        value.kind === 'diagnostic' || previous?.window.phase === 'diagnostic'
          ? 'diagnostic'
          : 'measurement';
      if (value.phase !== expectedPhase) return 'Window phase mismatch';
      this.windows.push({ window: value, callDepth: this.calls.length });
    } else {
      if (
        previous?.window.id !== value.id ||
        previous.callDepth !== this.calls.length
      )
        return 'Window closed outside its owning scope';
      this.windows.pop();
    }
    return null;
  }

  private call(
    event: Extract<Event, { readonly kind: 'enter' | 'leave' }>
  ): string | null {
    const call = event.call;
    if (
      !same(call.windows, this.windowIds()) ||
      call.phase !== this.currentPhase()
    )
      return 'Call window/phase mismatch';
    if (event.kind === 'enter') {
      if (call.parentId !== (this.calls.at(-1)?.id ?? null))
        return 'Call parent mismatch';
      this.calls.push(call);
    } else {
      if (this.calls.at(-1)?.id !== call.id)
        return 'Call returned outside its owning scope';
      this.calls.pop();
    }
    return null;
  }

  private bytes(entry: ByteRecord): string | null {
    const parent = this.calls.at(-1);
    if (
      !same(entry.windows, this.windowIds()) ||
      entry.phase !== this.currentPhase()
    )
      return 'Byte window/phase mismatch';
    if (entry.callId !== (parent?.id ?? null))
      return 'Byte invocation parent mismatch';
    if (
      !nonnegative(entry.bytes) ||
      !named(entry.method) ||
      !direction(entry.direction)
    )
      return 'Invalid raw byte count';
    if (entry.kind === 'scalar') {
      if (
        entry.source !== 'physical-scalar' ||
        parent?.layer !== 'physical' ||
        entry.method !== parent.method
      )
        return 'Scalar bytes must belong to a physical invocation';
    } else if (
      entry.kind !== 'buffer' ||
      entry.source !== 'physical-payload-transfer'
    )
      return 'Invalid payload source';
    return null;
  }

  private references(entry: ReferenceRecord): string | null {
    const parent = this.calls.at(-1);
    if (
      !same(entry.windows, this.windowIds()) ||
      entry.phase !== this.currentPhase()
    )
      return 'Reference window/phase mismatch';
    if (entry.source === 'physical-reference') {
      if (
        parent?.id !== entry.callId ||
        parent.layer !== 'physical' ||
        parent.method !== entry.method
      )
        return 'Reference slots must belong to a physical invocation';
    } else if (entry.source === 'physical-reference-table') {
      if (
        entry.callId !== (parent?.id ?? null) ||
        entry.slots !== 1 ||
        !named(entry.method)
      )
        return 'Invalid table reference transfer';
    } else return 'Invalid reference source';
    if (!nonnegative(entry.slots) || !direction(entry.direction))
      return 'Invalid raw reference count';
    return null;
  }
}
