import type {
  ICompatCaptureLeases,
  IForeignRecordRef,
} from '@macro-inc/collaboration/session/compatibility.generated';

export interface CaptureLeaseDrain {
  readonly leases: ICompatCaptureLeases;
}

interface Capture {
  readonly record: IForeignRecordRef;
  owners: number;
  nativeHeld: boolean;
  inFlight: boolean;
}

interface Flight {
  readonly drain: CaptureLeaseDrain;
  readonly retain: readonly Capture[];
  readonly release: readonly Capture[];
}

/** Local ownership of issued captures; native admission is acknowledged explicitly. */
export class CaptureLeases {
  private readonly captures = new Map<bigint, Capture>();
  private readonly dirty = new Set<bigint>();
  private flight: Flight | undefined;

  constructor(private readonly editorId: number) {
    if (!Number.isInteger(editorId) || editorId <= 0 || editorId > 0xffffffff)
      throw new Error('Capture leases require a valid native editor id');
  }

  hasOwners(captureId: bigint): boolean {
    return (this.captures.get(captureId)?.owners ?? 0) > 0;
  }

  retain(record: IForeignRecordRef): void {
    this.validate(record);
    let capture = this.captures.get(record.captureId);
    if (capture === undefined) {
      capture = { record, owners: 0, nativeHeld: false, inFlight: false };
      this.captures.set(record.captureId, capture);
    } else this.checkAuthority(capture.record, record);
    if (capture.owners === Number.MAX_SAFE_INTEGER)
      throw new Error('Capture lease owner count overflow');
    capture.owners++;
    this.reconcile(capture);
  }

  release(record: IForeignRecordRef): void {
    this.validate(record);
    const capture = this.captures.get(record.captureId);
    if (capture === undefined || capture.owners === 0)
      throw new Error('Capture lease has no local owner to release');
    this.checkAuthority(capture.record, record);
    capture.owners--;
    this.reconcile(capture);
  }

  beginDrain(): CaptureLeaseDrain | undefined {
    if (this.flight !== undefined)
      throw new Error('Capture lease drain is already in flight');
    if (this.dirty.size === 0) return;
    const retain: Capture[] = [];
    const release: Capture[] = [];
    for (const id of this.dirty) {
      const capture = this.captures.get(id);
      if (capture === undefined)
        throw new Error('Capture lease pending ownership is missing');
      if (capture.owners > 0) retain.push(capture);
      else release.push(capture);
    }
    const retainIds = retain.map((capture) => capture.record.captureId);
    const releaseIds = release.map((capture) => capture.record.captureId);
    Object.freeze(retainIds);
    Object.freeze(releaseIds);
    const leases: ICompatCaptureLeases = {
      editorId: this.editorId,
      retain: retainIds,
      release: releaseIds,
    };
    Object.freeze(leases);
    const drain: CaptureLeaseDrain = { leases };
    Object.freeze(drain);
    for (const capture of retain) capture.inFlight = true;
    for (const capture of release) capture.inFlight = true;
    this.flight = { drain, retain, release };
    return drain;
  }

  acknowledge(drain: CaptureLeaseDrain): void {
    const flight = this.requireFlight(drain);
    for (const capture of flight.retain) capture.nativeHeld = true;
    for (const capture of flight.release) capture.nativeHeld = false;
    this.finish(flight);
  }

  rollback(drain: CaptureLeaseDrain): void {
    this.finish(this.requireFlight(drain));
  }

  private requireFlight(drain: CaptureLeaseDrain): Flight {
    if (this.flight === undefined || this.flight.drain !== drain)
      throw new Error('Capture lease drain is not the active drain');
    return this.flight;
  }

  private finish(flight: Flight): void {
    this.flight = undefined;
    for (const capture of flight.retain) {
      capture.inFlight = false;
      this.reconcile(capture);
    }
    for (const capture of flight.release) {
      capture.inFlight = false;
      this.reconcile(capture);
    }
  }

  private reconcile(capture: Capture): void {
    const id = capture.record.captureId;
    if (capture.owners > 0 !== capture.nativeHeld) this.dirty.add(id);
    else this.dirty.delete(id);
    if (capture.owners === 0 && !capture.nativeHeld && !capture.inFlight)
      this.captures.delete(id);
  }

  private validate(record: IForeignRecordRef): void {
    if (record.node.editorId !== this.editorId)
      throw new Error('Capture lease belongs to another editor');
    if (record.captureId <= 0n || record.captureId > 0xffffffffffffffffn)
      throw new Error('Capture lease requires an issued nonzero uint64 id');
  }

  private checkAuthority(
    expected: IForeignRecordRef,
    actual: IForeignRecordRef
  ): void {
    if (
      expected.captureId !== actual.captureId ||
      expected.updateId !== actual.updateId ||
      expected.access !== actual.access ||
      expected.node.editorId !== actual.node.editorId ||
      expected.node.version !== actual.node.version ||
      expected.node.key.index !== actual.node.key.index ||
      expected.node.key.generation !== actual.node.key.generation ||
      expected.node.instanceOwnerId !== actual.node.instanceOwnerId ||
      expected.node.classId !== actual.node.classId ||
      expected.node.instanceId !== actual.node.instanceId
    )
      throw new Error('Capture lease authority changed for an issued id');
  }
}
