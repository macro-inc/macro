import {
  CompatBatchReply,
  CompatBatchRequest,
  CompatBatchScope,
  type ICompatBatchOperation,
  type ICompatBatchReply,
  type ICompatBeginRequest,
  type ICompatCaptureLeases,
} from '@macro-inc/collaboration/session/compatibility.generated';

interface PendingBatch {
  readonly expectedVersion: bigint;
  readonly begin: ICompatBeginRequest;
  readonly operations: ICompatBatchOperation[];
  retired?: boolean;
  acknowledged?: {
    readonly updateId: number;
    readonly version: bigint;
    readonly epoch: bigint;
  };
}

export interface BatchTransport {
  readonly call: (request: Uint8Array) => Uint8Array;
  readonly now: () => number;
  readonly wall: () => number;
  /** Apply every returned effect, including a failing operation's partial delta. */
  readonly acknowledge: (reply: ICompatBatchReply) => void;
}

/** Ordered native intents. This queue never edits an acknowledged node graph. */
export class NativeBatch {
  private pending: PendingBatch | undefined;
  private sending = false;
  private failedTransport = false;
  private failedRetirementAcknowledgement = false;

  constructor(private readonly transport: BatchTransport) {}

  /** Opening a public update alone makes no native call or key reservation. */
  begin(expectedVersion: bigint, begin: ICompatBeginRequest): void {
    this.checkRetirementAcknowledgement();
    if (this.pending !== undefined)
      throw new Error('A native batch scope is already pending');
    if (this.failedTransport)
      throw new Error('Discard the failed native batch scope first');
    this.pending = {
      expectedVersion,
      begin: {
        tags: [...begin.tags],
        reserveKeys: begin.reserveKeys,
        classMaskPatches: begin.classMaskPatches.map((patch) => ({ ...patch })),
      },
      operations: [],
    };
  }

  /** Transfer the intent and its argument arrays; the caller must not mutate them. */
  enqueue(operation: ICompatBatchOperation): void {
    const pending = this.writable();
    pending.operations.push(operation);
  }

  get hasNativeScope(): boolean {
    return this.pending?.acknowledged !== undefined;
  }

  get hasOperations(): boolean {
    return this.pending !== undefined && this.pending.operations.length > 0;
  }

  /** A semantic barrier, synchronous normalization flush, or later admission. */
  send(finalize: boolean, leases: ICompatCaptureLeases): ICompatBatchReply {
    const pending = this.writable();
    const acknowledged = pending.acknowledged;
    const scope = acknowledged
      ? CompatBatchScope.fromCompatBatchContinue({
          updateId: acknowledged.updateId,
          expectedEpoch: acknowledged.epoch,
        })
      : CompatBatchScope.fromCompatBatchBegin({
          expectedVersion: pending.expectedVersion,
          begin: pending.begin,
        });
    const operations = [...pending.operations];
    const request = CompatBatchRequest.encode({
      scope,
      leases,
      operations,
      finalize,
      now: this.transport.now(),
      wall: this.transport.wall(),
    }).slice();
    this.sending = true;
    try {
      const reply = CompatBatchReply.decode(this.transport.call(request));
      this.validate(
        reply,
        operations.length,
        finalize,
        acknowledged,
        pending.expectedVersion
      );
      // A typed failure consumed the request too. Never replay its partial
      // failing operation or execute the skipped suffix on a later flush.
      pending.operations.splice(0, operations.length);
      pending.acknowledged = {
        updateId: reply.updateId,
        version: reply.version,
        epoch: reply.mutationEpoch,
      };
      pending.retired = reply.published || reply.noop;
      this.transport.acknowledge(reply);
      return reply;
    } catch (error) {
      if (pending.retired) {
        // Native retirement is known even when applying its receipt fails.
        // Discard cannot undo that publication or restore a retired scope.
        this.failedRetirementAcknowledgement = true;
        throw error;
      }
      // An invalid/missing acknowledgement leaves effects unknown. Only the
      // real native discard path may recover; retrying could duplicate writes.
      this.failedTransport = true;
      throw error;
    } finally {
      this.sending = false;
    }
  }

  /** Call only after an actual publication/no-op retirement/discard succeeds. */
  retire(): void {
    this.checkRetirementAcknowledgement();
    if (this.sending)
      throw new Error('Cannot retire a native batch during its call');
    this.pending = undefined;
    this.failedTransport = false;
  }

  private writable(): PendingBatch {
    this.checkRetirementAcknowledgement();
    if (this.sending)
      throw new Error('Use the scoped callback transport during a native call');
    if (this.failedTransport)
      throw new Error('Discard the failed native batch scope first');
    if (this.pending === undefined)
      throw new Error('No public update owns this native batch');
    if (this.pending.retired)
      throw new Error('The native batch scope has already retired');
    return this.pending;
  }

  private checkRetirementAcknowledgement(): void {
    if (this.failedRetirementAcknowledgement)
      throw new Error(
        'Native retirement acknowledgement failed; dispose the editor'
      );
  }

  private validate(
    reply: ICompatBatchReply,
    operations: number,
    finalize: boolean,
    previous: PendingBatch['acknowledged'],
    expectedVersion: bigint
  ): void {
    this.validateScope(reply, previous, expectedVersion);
    this.validateResults(reply, operations, finalize);
  }

  private validateScope(
    reply: ICompatBatchReply,
    previous: PendingBatch['acknowledged'],
    expectedVersion: bigint
  ): void {
    if (reply.published && reply.noop)
      throw new Error('Native batch cannot both publish and retire as a no-op');
    if (reply.updateId === 0 || (reply.version === 0n && !reply.noop))
      throw new Error('Native mutable batch has no issued scope');
    if (reply.noop && reply.version !== expectedVersion)
      throw new Error('Native no-op changed the committed graph version');
    if (!reply.noop && reply.version <= expectedVersion)
      throw new Error('Native batch did not issue a newer pending version');
    if (
      previous &&
      (reply.updateId !== previous.updateId ||
        (!reply.noop && reply.version !== previous.version) ||
        reply.mutationEpoch < previous.epoch)
    )
      throw new Error('Native batch changed its pending scope or regressed');
    if (reply.dirtyType < 0 || reply.dirtyType > 2)
      throw new Error('Native batch has an invalid dirty type');
  }

  private validateResults(
    reply: ICompatBatchReply,
    operations: number,
    finalize: boolean
  ): void {
    const outcome = reply.outcome.data;
    if (outcome.discriminator === 1) {
      if (reply.results.length !== operations)
        throw new Error('Native batch omitted operation results');
      if (finalize && !reply.published && !reply.noop)
        throw new Error('Native admission did not publish or retire its scope');
    } else {
      const location = outcome.value.location.data;
      if (reply.noop || (reply.published && location.discriminator !== 2))
        throw new Error('Only finalization failure may accompany publication');
      if (location.discriminator === 1) {
        if (
          location.value.index >= operations ||
          location.value.index !== reply.results.length
        )
          throw new Error('Native batch failure has an invalid prefix');
      } else if (reply.results.length !== operations) {
        throw new Error('Native finalization omitted prefix results');
      }
    }
    if (reply.published && !finalize)
      throw new Error('A normalization flush cannot admit editor state');
  }
}
