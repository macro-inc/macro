import type { IForeignRecordRef } from '@macro-inc/collaboration/session/compatibility.generated';
import type { NodeLifetime } from '../../src/backend';
import { CaptureOwners } from '../../src/backend/production/capture-owners';
import { CapturedRecords } from '../../src/backend/production/records';
import { NativeFixture } from './fixture';

/** Uses the production owner registry and actual issued native records. */
export class RawCaptureFixture extends NativeFixture {
  constructor(hosted = false) {
    super('manual', hosted);
  }
  readonly captures = new CaptureOwners({
    retain: (record) => this.leases.retain(record),
    release: (record) => this.leases.release(record),
    collected: (handle, record) => {
      this.event('actual-capture-finalizer-enqueued', record.node.version);
      this.finalized.push(record.captureId);
      this.records.prune(record.captureId, (ref) =>
        this.leases.hasOwners(ref.captureId)
      );
      this.handles.releaseCaptureHandle(handle);
      this.onCaptureFinalized?.(record);
    },
    scheduleDrain: () => {
      this.event('actual-capture-release-scheduled');
      queueMicrotask(() => {
        if (!this.drainCaptures()) return;
        this.onCaptureAcknowledged?.();
      });
    },
  });
  readonly records = new CapturedRecords((handle, _previous, next) =>
    this.captures.refresh(handle, next)
  );
  private captureClosed = false;
  readonly finalized: bigint[] = [];
  onCaptureFinalized: ((record: IForeignRecordRef) => void) | undefined;
  onCaptureAcknowledged: (() => void) | undefined;

  override nodeLifetime(handle: number, node: object): NodeLifetime {
    return {
      kind: 'capture',
      owner: this.captures.own(handle, node, this.records.reference(handle)),
    };
  }
  wrapper(reference: IForeignRecordRef): object {
    const data = this.initial.batch.records.find(
      (record) => record.record.captureId === reference.captureId
    );
    if (!data)
      throw new Error('Wrapper must use an actual issued fixture record');
    this.records.accept([data]);
    const node = Object.freeze({});
    this.handles.adopt(this.records.raw(reference), node);
    return node;
  }
  override releaseVersion(version: bigint): void {
    super.releaseVersion(version);
    this.records.release(version, (record) =>
      this.leases.hasOwners(record.captureId)
    );
  }
  override close(): void {
    this.captureClosed = true;
    super.close();
  }
  drainCaptures(): boolean {
    if (this.captureClosed || this.pending) return false;
    this.flushLeases();
    this.event('actual-capture-release-acknowledged');
    return true;
  }
}
