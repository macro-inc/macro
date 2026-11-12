import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import { ListenerTableMsg } from '@macro-inc/collaboration/session/abi.generated';
import type {
  ExecutorCompletion,
  ExecutorDrain,
  ExecutorFailure,
} from '@macro-inc/collaboration/session/executor';
import { Flag } from '@macro-inc/collaboration/session/output';
import type {
  EditorSession,
  ViewCommandFailure,
} from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { ListenerMetadataCache } from './listener-metadata';
import type { NativeEnterDispatcher } from './native-enter';
import { assertNativeSessionReceiverAdmission } from './native-session-guard';

interface ReportedFailure {
  readonly invocation: bigint;
  readonly scope: bigint;
}
export interface NativeCallbackFailure extends ReportedFailure {
  readonly error: unknown;
}
export interface NativeEnterBinding {
  readonly dispatcher: NativeEnterDispatcher;
  readonly owner: bigint;
  readonly output: NativeEnterOutput;
}

/** Failure ordinals belong to exactly one encoded native output, never its text. */
export class NativeEnterOutput {
  private pending: {
    readonly lease: ViewCommandFailure;
    readonly valid: boolean;
  }[] = [];
  private reported: (ReportedFailure & {
    readonly completion?: ExecutorCompletion;
  })[] = [];
  private currentCompletion: ExecutorCompletion | undefined;
  private readonly completionFailures = new Map<
    ExecutorCompletion,
    {
      original?: ExecutorFailure;
      fault?: ExecutorFailure;
      secondary?: ExecutorFailure;
    }
  >();
  private secondary: (ExecutorFailure & { readonly input?: boolean })[] = [];
  private readonly additional: NativeCallbackFailure[] = [];
  private fault: ExecutorFailure | undefined;
  private detached = false;
  private listenerRefreshPending = false;
  private listenerMetadataEnabled = false;
  private acknowledgementEntry:
    | { readonly ticket: object; readonly returned: bigint }
    | undefined;
  private acknowledgementTransfer:
    | { readonly ticket: object; readonly transferred: bigint }
    | undefined;
  private readonly listenerMetadata:
    | {
        readonly cache: ListenerMetadataCache;
        readonly idle: () => boolean;
      }
    | undefined;

  constructor(
    private readonly session: EditorSession,
    private readonly dispatcher: NativeEnterDispatcher,
    private readonly owner: bigint,
    private readonly onError: (error: unknown) => void,
    metadataIdle?: () => boolean
  ) {
    this.listenerMetadata = metadataIdle
      ? {
          cache: new ListenerMetadataCache(
            () => dispatcher.guard.completedEntryToken(),
            () => !this.detached && dispatcher.isBoundSession(session, owner)
          ),
          idle: metadataIdle,
        }
      : undefined;
    if (this.listenerMetadata)
      dispatcher.bindListenerMetadata(session, owner, {
        invalidate: () => this.invalidateListenerMetadata(),
        refresh: () => this.refreshListenerMetadata(),
      });
  }

  enableListenerMetadata(): void {
    this.assertLocalAdmission();
    const metadata = this.listenerMetadata;
    if (!metadata || !this.dispatcher.supportsBlockNavigation) return;
    if (
      !metadata.idle() ||
      !this.dispatcher.isBoundSession(this.session, this.owner)
    )
      throw new Error('Listener metadata binding is not idle or current');
    this.session.enableViewListenerMetadata(this.owner);
    this.listenerMetadataEnabled = true;
  }
  /** Called immediately AFTER one actual owned native Port call returns. */
  captureAcknowledgement(flags: number): object | undefined {
    this.acknowledgementEntry = undefined;
    this.acknowledgementTransfer = undefined;
    if (
      flags !== Flag.View ||
      !this.listenerMetadataEnabled ||
      this.detached ||
      this.fault ||
      !this.dispatcher.isBoundSession(this.session, this.owner)
    )
      return undefined;
    const ticket = {};
    this.acknowledgementEntry = {
      ticket,
      returned: this.dispatcher.guard.completedEntryToken(),
    };
    return ticket;
  }
  /** One-use logical-zero proof; does not mask flags or authorize a model write. */
  consumeAcknowledgement(ticket: object | undefined, flags: number): boolean {
    const proof = this.acknowledgementTransfer;
    this.acknowledgementTransfer = undefined;
    this.acknowledgementEntry = undefined;
    return (
      flags === Flag.View &&
      ticket !== undefined &&
      proof?.ticket === ticket &&
      !this.detached &&
      !this.fault &&
      this.listenerMetadataEnabled &&
      this.dispatcher.isBoundSession(this.session, this.owner) &&
      proof.transferred === this.dispatcher.guard.completedEntryToken()
    );
  }
  private invalidateListenerMetadata(): void {
    this.listenerMetadata?.cache.invalidate();
    if (!this.detached) this.listenerRefreshPending = true;
  }

  /** Never throws: registration/cleanup acceptance is independent of metadata. */
  refreshListenerMetadata(): void {
    const metadata = this.listenerMetadata;
    if (!metadata || this.detached || !this.listenerRefreshPending) return;
    if (!metadata.idle() || this.dispatcher.activeScope()) return;
    try {
      // Uses the existing module guard, including provider/pure-observer union.
      assertNativeSessionReceiverAdmission(this.session);
    } catch {
      // Defer ONLY the read; existing afterDrain is the sole retry owner.
      return;
    }
    this.listenerRefreshPending = false;
    try {
      this.dispatcher.assertRootAdmission();
      this.assertAttached();
      const bytes = this.session.listenerTable();
      const token = this.dispatcher.guard.completedEntryToken();
      if (this.listenerMetadataEnabled)
        metadata.cache.accept(ListenerTableMsg.decode(bytes), 'cold', token);
    } catch (error) {
      metadata.cache.invalidate();
      this.report(error);
    }
  }

  needsKeyDown(key: string): boolean | undefined {
    return this.listenerMetadataEnabled
      ? this.listenerMetadata?.cache.needsKeyDown(key)
      : undefined;
  }
  listenerLevels(command: string, key?: string): number | undefined {
    return this.listenerMetadataEnabled
      ? this.listenerMetadata?.cache.levels(command, key)
      : undefined;
  }
  acceptColdListenerTable(
    table: ReturnType<typeof ListenerTableMsg.decode>,
    token: bigint
  ): void {
    try {
      if (this.listenerMetadataEnabled)
        this.listenerMetadata?.cache.accept(table, 'cold', token);
    } catch (error) {
      this.listenerMetadata?.cache.invalidate();
      this.report(error);
    }
  }
  /** First sink boundary after actual native takeOutput, before ANY output callbacks. */
  observeListenerMetadata(
    words: Uint32Array,
    strings: Uint8Array,
    effects: IViewEffectMsg[]
  ): {
    readonly effects: IViewEffectMsg[];
    readonly metadataOnly: boolean;
  } {
    const token = this.dispatcher.guard.completedEntryToken();
    const metadata = effects.filter(
      (effect) => effect.kind === 6 && effect.code === 11
    );
    const remaining = effects.filter(
      (effect) => effect.kind !== 6 || effect.code !== 11
    );
    if (metadata.length !== 1) {
      this.listenerMetadata?.cache.invalidate();
      return { effects: remaining, metadataOnly: false };
    }
    const effect = metadata[0];
    let valid = false;
    try {
      const priorities: unknown = JSON.parse(effect.style);
      if (
        !Array.isArray(priorities) ||
        priorities.length !== effect.keys.length ||
        !priorities.every(
          (priority): priority is number =>
            Number.isInteger(priority) && priority >= 0 && priority <= 31
        )
      )
        throw new Error('Invalid listener metadata priorities');
      const table = {
        rows: effect.keys.map((command, index) => ({
          command,
          priority: priorities[index],
        })),
      };
      if (this.listenerMetadataEnabled)
        valid =
          this.listenerMetadata?.cache.accept(table, 'output', token) === true;
    } catch (error) {
      this.listenerMetadata?.cache.invalidate();
      this.report(error);
    }
    const entry = this.acknowledgementEntry;
    if (
      valid &&
      !effect.flag &&
      words.length === 0 &&
      strings.length === 0 &&
      remaining.length === 0 &&
      entry &&
      entry.returned + 1n === token &&
      !this.detached &&
      !this.fault &&
      this.listenerMetadataEnabled &&
      this.dispatcher.isBoundSession(this.session, this.owner)
    ) {
      this.acknowledgementTransfer = {
        ticket: entry.ticket,
        transferred: token,
      };
    }
    return { effects: remaining, metadataOnly: !effect.flag };
  }

  assertLocalAdmission(): void {
    this.dispatcher.assertRootAdmission();
    this.assertAttached();
    if (this.fault) throw this.fault.error;
  }
  beginTeardown(): void {
    this.detached = true;
    this.acknowledgementEntry = undefined;
    this.acknowledgementTransfer = undefined;
    this.listenerMetadataEnabled = false;
    this.listenerRefreshPending = false;
    this.listenerMetadata?.cache.close();
  }
  assertAttached(): void {
    if (this.detached) throw new Error('Native editor view is closing');
  }

  recordSecondary(error: unknown, input = false): void {
    this.secondary.push({ error, input });
    const completion =
      input && this.currentCompletion?.running
        ? this.currentCompletion
        : undefined;
    if (completion) this.failuresFor(completion).secondary ??= { error };
  }
  private failuresFor(completion: ExecutorCompletion) {
    let failures = this.completionFailures.get(completion);
    if (!failures) {
      failures = {};
      this.completionFailures.set(completion, failures);
    }
    return failures;
  }
  private rememberFault(
    error: unknown,
    completion = this.currentCompletion
  ): void {
    this.fault ??= { error };
    if (completion?.running) this.failuresFor(completion).fault ??= { error };
  }

  takeFailure(): NativeCallbackFailure | undefined {
    this.dispatcher.assertRootAdmission();
    return this.additional.shift();
  }

  beforeConsume(flags: number, completion?: ExecutorCompletion): void {
    this.acknowledgementTransfer = undefined;
    // The just-returned owned call installed a fresh ticket. All other entries,
    // including a prior failed/queued operation, cannot reuse an old candidate.
    if (
      flags !== Flag.View ||
      this.acknowledgementEntry?.returned !==
        this.dispatcher.guard.completedEntryToken()
    )
      this.acknowledgementEntry = undefined;
    this.currentCompletion = completion;
    if (!this.dispatcher.hasFailures(this.owner)) return;
    try {
      for (;;) {
        const lease = this.session.takeViewCommandFailure();
        if (!lease) break;
        const valid = this.dispatcher.hasFailure(
          this.owner,
          lease.invocation,
          lease.scope
        );
        this.pending.push({ lease, valid });
        if (!valid) {
          this.rememberFault(
            new Error('Native callback failure has no matching issued cause')
          );
          continue;
        }
        if (
          !this.reported.some(
            (value) =>
              value.scope === lease.scope &&
              value.invocation === lease.invocation
          )
        )
          this.reported.push({
            invocation: lease.invocation,
            scope: lease.scope,
            completion,
          });
      }
      if (!(flags & (Flag.View | Flag.Io | Flag.Error | Flag.NeedPeerIds))) {
        if (this.pending.some(({ lease }) => lease.current))
          throw new Error('Native callback failure lacks its output flags');
        this.releasePacket();
      }
    } catch (error) {
      this.rememberFault(error);
    }
  }

  filter(effects: IViewEffectMsg[]): IViewEffectMsg[] {
    const deferred = new Set<number>();
    try {
      for (const { lease, valid } of this.pending) {
        if (!valid || !lease.current) continue;
        const ordinals = lease.effectOrdinals();
        if (ordinals.length === 0)
          throw new Error('Native callback failure has no effect ordinal');
        let previous = -1;
        for (const ordinal of ordinals) {
          const effect = effects[ordinal];
          if (
            ordinal <= previous ||
            deferred.has(ordinal) ||
            !effect ||
            (effect.kind !== 2 && effect.kind !== 6)
          )
            throw new Error(
              'Native callback failure effect ordinal is invalid'
            );
          previous = ordinal;
          deferred.add(ordinal);
        }
      }
      return effects.filter((_, ordinal) => !deferred.has(ordinal));
    } catch (error) {
      this.rememberFault(error);
      return effects;
    } finally {
      this.releasePacket();
    }
  }

  private releasePacket(): void {
    const leases = this.pending;
    this.pending = [];
    for (const { lease } of leases) {
      try {
        lease.free();
      } catch (error) {
        this.rememberFault(error);
      }
    }
  }

  afterDrain(aborted?: ExecutorFailure, drain?: ExecutorDrain): void {
    this.acknowledgementEntry = undefined;
    this.acknowledgementTransfer = undefined;
    this.currentCompletion = undefined;
    // Executor has set busy=false; inherited onCommit/onDrain callbacks ran first.
    this.refreshListenerMetadata();
    if (aborted && this.dispatcher.hasFailures(this.owner))
      this.fault ??= aborted;
    this.releasePacket();
    const causes: NativeCallbackFailure[] = [];
    for (const report of this.reported) {
      try {
        const cause = this.dispatcher.failure(
          this.owner,
          report.invocation,
          report.scope
        );
        if (cause) {
          causes.push({
            invocation: report.invocation,
            scope: report.scope,
            error: cause.error,
          });
          if (report.completion)
            this.failuresFor(report.completion).original ??= {
              error: cause.error,
            };
        } else {
          const error = new Error(
            'Native callback cause disappeared before drain'
          );
          this.fault ??= { error };
          if (report.completion)
            this.failuresFor(report.completion).fault ??= { error };
        }
      } catch (error) {
        this.rememberFault(error);
        if (report.completion)
          this.failuresFor(report.completion).fault ??= { error };
      }
    }
    this.reported = [];
    if (!this.fault) this.dispatcher.clearFailures(this.owner);
    for (;;) {
      const failure = this.dispatcher.guard.takeCleanupFailure();
      if (!failure) break;
      this.secondary.push(failure);
    }
    const secondary = this.secondary;
    this.secondary = [];
    const original = causes.shift();
    if (aborted && original) this.additional.push(original);
    this.additional.push(...causes);
    if (original) {
      try {
        this.onError(original.error);
      } catch (error) {
        if (error !== original.error) secondary.push({ error });
      }
    }
    for (const [completion, failures] of this.completionFailures) {
      const failure = failures.original ?? failures.fault ?? failures.secondary;
      if (failure) completion.fail(failure.error);
    }
    this.completionFailures.clear();
    const secondaryPrimary =
      !aborted && !original && !this.fault ? secondary.shift() : undefined;
    const primary = aborted ?? original ?? this.fault ?? secondaryPrimary;
    for (const failure of [...causes, ...secondary]) this.report(failure.error);
    if (aborted && original) this.report(original.error);
    if (!aborted && primary) {
      if (original || this.fault || secondaryPrimary?.input)
        drain?.attributeFailure();
      throw primary.error;
    }
  }

  private report(error: unknown): void {
    try {
      Telemetry.error(error, { surface: 'editor.command.secondary' });
    } catch {
      /* A secondary reporter cannot replace the original thrown value. */
    }
  }
}
