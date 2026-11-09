import type { IForeignRecordRef } from '@macro-inc/collaboration/session/compatibility.generated';

export interface CaptureOwnerPorts {
  retain(record: IForeignRecordRef): void;
  release(record: IForeignRecordRef): void;
  collected(handle: number, record: IForeignRecordRef): void;
  scheduleDrain(): void;
}

interface Slot {
  readonly handle: number;
  reference: IForeignRecordRef;
}
interface Owner {
  readonly slot: Slot;
  readonly node: object;
}
interface GraphOwner {
  count: number;
  owner?: Owner;
}

/** Exact raw-wrapper ownership; graph retention and native leases stay independent. */
export class CaptureOwners {
  private static readonly collected = new FinalizationRegistry<{
    readonly store: WeakRef<CaptureOwners>;
    readonly slot: Slot;
  }>(({ store, slot }) => store.deref()?.collect(slot));
  private readonly owners = new Map<number, WeakRef<Owner>>();
  private readonly graph = new Map<number, GraphOwner>();

  constructor(private readonly ports: CaptureOwnerPorts) {}

  own(handle: number, node: object, reference: IForeignRecordRef): object {
    this.validateHandle(handle);
    let owner = this.owners.get(handle)?.deref();
    if (owner !== undefined) {
      if (owner.node !== node)
        throw new Error('A live native instance already owns this handle');
      this.sameReference(owner.slot.reference, reference);
      return owner;
    }
    this.ports.retain(reference);
    owner = { slot: { handle, reference }, node };
    this.owners.set(handle, new WeakRef(owner));
    CaptureOwners.collected.register(owner, {
      store: new WeakRef(this),
      slot: owner.slot,
    });
    const graph = this.graph.get(handle);
    if (graph !== undefined) graph.owner = owner;
    return owner;
  }

  /** CapturedRecords validates instance authority before forwarding a refresh. */
  refresh(handle: number, next: IForeignRecordRef): void {
    const owner = this.owners.get(handle)?.deref();
    if (owner === undefined) return;
    const previous = owner.slot.reference;
    if (previous.captureId === next.captureId) {
      this.sameReference(previous, next);
      return;
    }
    this.ports.retain(next);
    owner.slot.reference = next;
    this.ports.release(previous);
  }

  /** Mirror/history references already own their own native capture leases. */
  retainHandle(handle: number): void {
    this.validateHandle(handle);
    const graph = this.graph.get(handle);
    if (graph !== undefined) {
      if (graph.count === Number.MAX_SAFE_INTEGER)
        throw new Error('Capture graph owner count overflow');
      graph.count++;
      return;
    }
    this.graph.set(handle, {
      count: 1,
      owner: this.owners.get(handle)?.deref(),
    });
  }

  releaseHandle(handle: number): void {
    const graph = this.graph.get(handle);
    if (graph === undefined)
      throw new Error('Capture graph has no owner to release');
    if (--graph.count === 0) this.graph.delete(handle);
  }

  /** Called only by the module registry; the slot never retains its target. */
  private collect(slot: Slot): void {
    this.ports.release(slot.reference);
    if (this.owners.get(slot.handle)?.deref() === undefined)
      this.owners.delete(slot.handle);
    this.ports.collected(slot.handle, slot.reference);
    this.ports.scheduleDrain();
  }

  private validateHandle(handle: number): void {
    if (!Number.isSafeInteger(handle) || handle < 0)
      throw new Error('Capture owner requires an exact node handle');
  }

  private sameReference(
    left: IForeignRecordRef,
    right: IForeignRecordRef
  ): void {
    if (
      left.captureId !== right.captureId ||
      left.updateId !== right.updateId ||
      left.access !== right.access ||
      left.node.editorId !== right.node.editorId ||
      left.node.version !== right.node.version ||
      left.node.key.index !== right.node.key.index ||
      left.node.key.generation !== right.node.key.generation ||
      left.node.instanceOwnerId !== right.node.instanceOwnerId ||
      left.node.classId !== right.node.classId ||
      left.node.instanceId !== right.node.instanceId
    )
      throw new Error('Capture owner authority changed for an issued id');
  }
}
