import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import { ListenerTableMsg } from '@macro-inc/collaboration/session/abi.generated';
import type {
  ExecutorCompletion,
  ExecutorDrain,
  ExecutorFailure,
  ExecutorOwnedTransfer,
} from '@macro-inc/collaboration/session/executor';
import { Flag } from '@macro-inc/collaboration/session/output';
import type {
  EditorSession,
  ViewCommandFailure,
} from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import {
  type InputDomDisposition,
  inputDomDisposition,
} from './input-dom-disposition';
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
    readonly completion?: ExecutorCompletion;
    readonly drain?: ExecutorDrain;
  }[] = [];
  private reported: (ReportedFailure & {
    readonly completion?: ExecutorCompletion;
    readonly drain?: ExecutorDrain;
  })[] = [];
  private currentCompletion: ExecutorCompletion | undefined;
  private readonly syncCompletions = new Set<ExecutorCompletion>();
  private readonly completionFailures = new Map<
    ExecutorCompletion,
    {
      original?: ExecutorFailure;
      fault?: ExecutorFailure;
      secondary?: ExecutorFailure;
    }
  >();
  private secondary: (ExecutorFailure & {
    readonly input?: boolean;
    readonly completion?: ExecutorCompletion;
    readonly drain?: ExecutorDrain;
  })[] = [];
  private readonly additional: NativeCallbackFailure[] = [];
  private fault:
    | (ExecutorFailure & {
        readonly completion?: ExecutorCompletion;
        readonly drain?: ExecutorDrain;
      })
    | undefined;
  private syncInput:
    | {
        readonly ticket: object;
        readonly completion: ExecutorCompletion;
        readonly deliverDom: (disposition: InputDomDisposition) => void;
        disposition?: InputDomDisposition;
        phase:
          | 'entry'
          | 'returned'
          | 'prepared'
          | 'no-output'
          | 'transferred'
          | 'used'
          | 'terminal';
        flags?: number;
        returned?: bigint;
        transferred?: bigint;
        failed: boolean;
        readonly eventName?: string;
        eventPayload?: string;
        observedEvents: number;
      }
    | undefined;
  private detached = false;
  private releaseCleanupDrain: (() => void) | undefined;
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
    metadataIdle?: () => boolean,
    private readonly runningDrain?: () => ExecutorDrain | undefined
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
    if (runningDrain)
      this.releaseCleanupDrain = dispatcher.guard.bindCleanupDrain(
        session,
        runningDrain
      );
    try {
      if (this.listenerMetadata)
        dispatcher.bindListenerMetadata(session, owner, {
          invalidate: () => this.invalidateListenerMetadata(),
          refresh: () => this.refreshListenerMetadata(),
        });
    } catch (error) {
      const release = this.releaseCleanupDrain;
      this.releaseCleanupDrain = undefined;
      try {
        release?.();
      } catch (cleanupError) {
        this.report(cleanupError);
      }
      throw error;
    }
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
  /** Begin before this accepted entry performs admission/factory native reads. */
  beginSyncCleanup(completion: ExecutorCompletion): object {
    this.assertLocalAdmission();
    if (!completion.running) throw new Error('Cleanup entry is not running');
    const drain = this.runningDrain?.();
    if (!drain || !drain.ownsCompletion(completion))
      throw new Error('Synchronous cleanup requires its actual executor fence');
    if (
      this.pending.length ||
      this.dispatcher.hasUnreportedFailures(this.owner, this.reported)
    )
      throw new Error('An older native callback output has not been drained');
    const ticket = this.dispatcher.guard.beginCleanupEntry(
      this.session,
      completion
    );
    this.syncCompletions.add(completion);
    return ticket;
  }
  assertSyncCleanup(ticket: object, completion: ExecutorCompletion): void {
    if (!completion.running)
      throw new Error('Cleanup entry already terminated');
    const [primary, ...secondary] =
      this.dispatcher.guard.takeCleanupEntryFailures(ticket, completion);
    for (const failure of secondary) {
      this.secondary.push({ error: failure.error, input: true, completion });
      this.failuresFor(completion).secondary ??= { error: failure.error };
    }
    // This actual opaque value becomes the real executor entry exception. Do
    // not also enqueue it as a secondary or synthesize no-input flags.
    if (primary) throw primary.error;
  }

  /** Each terminal cleanup fault stays on its actual still-running entry. */
  recordSyncCleanupFailure(
    completion: ExecutorCompletion,
    error: unknown
  ): void {
    if (!completion.running || !this.syncCompletions.has(completion))
      throw new Error('Cleanup failure has no actual running sync entry');
    // Settlement retains the first secondary even if later drain cleanup fails;
    // the owner retains every independent fault for exact-fence reporting.
    const earlier = this.completionFailures.get(completion)?.secondary;
    completion.failSecondary(earlier ? earlier.error : error);
    this.secondary.push({ error, input: true, completion });
  }

  finishSyncCleanup(ticket: object, completion: ExecutorCompletion): void {
    if (!completion.running)
      throw new Error('Cleanup entry already terminated');
    const failures = this.dispatcher.guard.finishCleanupEntry(
      ticket,
      completion
    );
    for (const failure of failures) {
      this.secondary.push({ error: failure.error, input: true, completion });
      this.failuresFor(completion).secondary ??= { error: failure.error };
    }
  }

  /** Entry-local transport ownership only; never an edit or commit receipt. */
  beginSyncInput(
    completion: ExecutorCompletion,
    deliverDom: (disposition: InputDomDisposition) => void,
    eventName?: string
  ): object {
    this.assertLocalAdmission();
    if (this.syncInput) throw new Error('Synchronous input is already active');
    if (!completion.running)
      throw new Error('Synchronous entry is not running');
    this.currentCompletion = completion;
    const ticket = {};
    this.syncInput = {
      ticket,
      completion,
      deliverDom,
      phase: 'entry',
      failed: false,
      eventName,
      observedEvents: 0,
    };
    return ticket;
  }

  captureSyncInput(ticket: object, flags: number): void {
    const entry = this.syncInput;
    if (!entry || entry.ticket !== ticket || entry.phase !== 'entry')
      throw new Error('Synchronous input ticket is not current');
    entry.flags = flags;
    entry.returned = this.dispatcher.guard.completedInputReturn(this.session);
    entry.phase = 'returned';
    if (
      entry.returned === undefined ||
      !entry.completion.running ||
      !this.syncBindingCurrent()
    )
      entry.failed = true;
  }

  private syncBindingCurrent(): boolean {
    return (
      !this.detached &&
      !this.fault &&
      this.dispatcher.isBoundSession(this.session, this.owner)
    );
  }
  private syncInputHealthy(): boolean {
    const entry = this.syncInput;
    return (
      !!entry &&
      entry.completion.running &&
      this.syncBindingCurrent() &&
      !this.completionFailures.has(entry.completion)
    );
  }

  private prepareSyncInput(flags: number): void {
    const entry = this.syncInput;
    if (!entry) return;
    if (
      entry.phase !== 'returned' ||
      entry.flags !== flags ||
      entry.returned !== this.dispatcher.guard.completedEntryToken() ||
      !this.syncInputHealthy()
    ) {
      entry.failed = true;
      return;
    }
    entry.phase =
      flags & (Flag.View | Flag.Io | Flag.NeedPeerIds | Flag.Error)
        ? 'prepared'
        : 'no-output';
  }

  /** Called only by the bound executor immediately after decode, before cause getters. */
  observeOwnedTransfer(transfer: ExecutorOwnedTransfer): void {
    const entry = this.syncInput;
    let decoded: ReturnType<typeof inputDomDisposition>;
    try {
      decoded = inputDomDisposition(transfer.effects);
    } catch (error) {
      if (entry) entry.failed = true;
      this.recordSecondary(error, true);
      return;
    }
    if (!entry) return;
    const token =
      entry.returned === undefined || entry.flags === undefined
        ? undefined
        : this.dispatcher.guard.completedOutputTransfer(
            entry.returned,
            this.session,
            Boolean(entry.flags & Flag.WakeChanged)
          );
    if (
      entry.phase !== 'prepared' ||
      entry.flags !== transfer.flags ||
      entry.completion !== transfer.completion ||
      !entry.completion.running ||
      token === undefined ||
      !this.syncInputHealthy()
    ) {
      entry.failed = true;
      return;
    }
    entry.transferred = token;
    entry.phase = 'transferred';
    // Decode before the only allowed DOM calls. A malformed record never grants a disposition.
    entry.disposition = {
      defaultPrevented:
        decoded.disposition.defaultPrevented ||
        transfer.effects.some(
          (effect) => effect.kind === 6 && effect.code === 2
        ),
      propagationStopped: decoded.disposition.propagationStopped,
    };
    // Native Error permits only these already-performed host facts, never semantic proof or fallback.
    entry.deliverDom(entry.disposition);
    if (entry.flags & Flag.Error) return;
    if (entry.eventName !== undefined) {
      const matching = transfer.effects.filter(
        (effect) =>
          effect.kind === 6 &&
          effect.code === 9 &&
          effect.text === entry.eventName
      );
      if (matching.length === 1) {
        entry.eventPayload = JSON.stringify(
          matching[0].style ? JSON.parse(matching[0].style) : null
        );
      }
      // No matching observation is not a transport failure and does not erase native prevention.
    }
  }

  /** Consume only the actual current entry's prevention, never next-entry global state. */
  syncEffects(effects: IViewEffectMsg[]): IViewEffectMsg[] {
    const entry = this.syncInput;
    // Semantic validation occurred at the owned transfer boundary. Strip only
    // AFTER callback leases have used their original native effect ordinals.
    return effects.filter(
      (effect) =>
        effect.kind !== 6 ||
        (effect.code !== 12 &&
          !(entry?.completion.running && effect.code === 2))
    );
  }

  canDeliverSyncDisposition(ticket: object): boolean {
    const entry = this.syncInput;
    return (
      !!entry &&
      entry.ticket === ticket &&
      entry.phase === 'transferred' &&
      !entry.failed &&
      entry.completion.running &&
      this.syncBindingCurrent() &&
      entry.transferred === this.dispatcher.guard.completedEntryToken()
    );
  }

  canObserveSyncInput(ticket: object): boolean {
    const entry = this.syncInput;
    return (
      !!entry &&
      entry.ticket === ticket &&
      entry.phase === 'transferred' &&
      !entry.failed &&
      entry.flags !== undefined &&
      !(entry.flags & Flag.Error) &&
      (entry.eventName === undefined || entry.eventPayload !== undefined) &&
      this.syncInputHealthy() &&
      entry.transferred === this.dispatcher.guard.completedEntryToken()
    );
  }

  acceptSyncPluginEvent(ticket: object, payload: unknown): boolean {
    const entry = this.syncInput;
    if (
      !entry ||
      !this.canObserveSyncInput(ticket) ||
      entry.eventName === undefined
    )
      return false;
    entry.observedEvents++;
    if (
      entry.observedEvents !== 1 ||
      JSON.stringify(payload) !== entry.eventPayload ||
      !this.canObserveSyncInput(ticket)
    ) {
      entry.failed = true;
      return false;
    }
    return true;
  }

  consumeSyncInput(
    ticket: object,
    flags: number
  ): InputDomDisposition | undefined {
    const entry = this.syncInput;
    if (
      !entry ||
      entry.ticket !== ticket ||
      entry.flags !== flags ||
      entry.failed ||
      flags & Flag.Error ||
      !this.syncInputHealthy()
    )
      return;
    if (entry.phase === 'no-output') {
      if (entry.returned !== this.dispatcher.guard.completedEntryToken())
        return;
    } else if (
      entry.phase !== 'transferred' ||
      entry.transferred !== this.dispatcher.guard.completedEntryToken()
    )
      return;
    entry.phase = 'used';
    return (
      entry.disposition ?? {
        defaultPrevented: false,
        propagationStopped: false,
      }
    );
  }

  finishSyncInput(ticket: object): void {
    const entry = this.syncInput;
    if (!entry || entry.ticket !== ticket) return;
    entry.phase = 'terminal';
    entry.failed = true;
    this.syncInput = undefined;
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
    if (this.syncInput) this.finishSyncInput(this.syncInput.ticket);
    this.detached = true;
    const release = this.releaseCleanupDrain;
    this.releaseCleanupDrain = undefined;
    this.acknowledgementEntry = undefined;
    this.acknowledgementTransfer = undefined;
    this.listenerMetadataEnabled = false;
    this.listenerRefreshPending = false;
    this.listenerMetadata?.cache.close();
    release?.();
  }
  assertAttached(): void {
    if (this.detached) throw new Error('Native editor view is closing');
  }

  /** Rendering failures belong to a sync entry only while that real entry runs. */
  recordApplyFailure(error: unknown): void {
    const completion = this.currentCompletion;
    this.recordSecondary(
      error,
      completion !== undefined &&
        completion.running &&
        this.syncCompletions.has(completion)
    );
  }

  recordSecondary(error: unknown, input = false): void {
    const completion =
      input && this.currentCompletion?.running
        ? this.currentCompletion
        : undefined;
    this.secondary.push({
      error,
      input,
      completion,
      drain: this.runningDrain?.(),
    });
    if (completion) this.failuresFor(completion).secondary ??= { error };
  }
  recordDrainSecondary(error: unknown, drain?: ExecutorDrain): void {
    this.secondary.push({ error, drain });
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
    this.fault ??= { error, completion, drain: this.runningDrain?.() };
    if (completion?.running) this.failuresFor(completion).fault ??= { error };
  }

  takeFailure(): NativeCallbackFailure | undefined {
    this.dispatcher.assertRootAdmission();
    return this.additional.shift();
  }

  beforeConsume(flags: number, completion?: ExecutorCompletion): void {
    this.prepareSyncInput(flags);
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
    if (!this.dispatcher.hasUnreportedFailures(this.owner, this.reported))
      return;
    try {
      for (;;) {
        const lease = this.session.takeViewCommandFailure();
        if (!lease) break;
        const valid = this.dispatcher.hasFailure(
          this.owner,
          lease.invocation,
          lease.scope
        );
        this.pending.push({
          lease,
          valid,
          completion,
          drain: this.runningDrain?.(),
        });
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
            drain: this.runningDrain?.(),
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
      for (const { lease, valid, completion, drain } of this.pending) {
        if (
          completion !== this.currentCompletion ||
          drain !== this.runningDrain?.()
        )
          continue;
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

  private releasePacket(drain = this.runningDrain?.()): void {
    const belongs = (row: (typeof this.pending)[number]) =>
      row.completion
        ? !!drain?.ownsCompletion(row.completion)
        : row.drain === drain;
    const leases = this.pending.filter(belongs);
    this.pending = this.pending.filter((row) => !belongs(row));
    for (const { lease, completion } of leases) {
      try {
        lease.free();
      } catch (error) {
        this.rememberFault(error, completion);
        if (completion) this.failuresFor(completion).fault ??= { error };
      }
    }
  }

  /** Enter before inherited teardown/drain callbacks; never sweep older rows. */
  beginDrain(drain?: ExecutorDrain): void {
    if (drain && this.runningDrain?.() !== drain)
      throw new Error('Output owner has no matching actual executor fence');
    this.collectDrainCleanup(drain);
  }
  private collectDrainCleanup(drain?: ExecutorDrain): void {
    // No drain means unsupported/unowned diagnostics stay retained for explicit
    // retrieval. They cannot be retroactively attached to a later input.
    if (!drain) return;
    for (;;) {
      const failure = this.dispatcher.guard.takeCleanupFailure(
        this.session,
        drain
      );
      if (!failure) break;
      this.secondary.push({ error: failure.error, drain });
    }
  }

  afterDrain(aborted?: ExecutorFailure, drain?: ExecutorDrain): void {
    this.acknowledgementEntry = undefined;
    this.acknowledgementTransfer = undefined;
    const belongs = (completion: ExecutorCompletion | undefined) =>
      drain
        ? completion !== undefined && drain.ownsCompletion(completion)
        : completion === undefined;
    this.currentCompletion = undefined;
    // Executor has set busy=false; inherited onCommit/onDrain callbacks ran first.
    this.refreshListenerMetadata();
    if (
      aborted &&
      this.dispatcher.hasUnreportedFailures(this.owner, this.reported)
    )
      this.fault ??= { ...aborted, drain };
    this.releasePacket(drain);
    const causes: NativeCallbackFailure[] = [];
    const reportBelongs = (report: (typeof this.reported)[number]) =>
      report.completion ? belongs(report.completion) : report.drain === drain;
    const reports = this.reported.filter(reportBelongs);
    this.reported = this.reported.filter((report) => !reportBelongs(report));
    for (const report of reports) {
      try {
        const cause = this.dispatcher.failure(
          this.owner,
          report.invocation,
          report.scope
        );
        if (cause) {
          this.dispatcher.clearFailure(
            this.owner,
            report.invocation,
            report.scope
          );
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
          this.fault ??= {
            error,
            completion: report.completion,
            drain: report.drain,
          };
          if (report.completion)
            this.failuresFor(report.completion).fault ??= { error };
        }
      } catch (error) {
        this.rememberFault(error);
        if (report.completion)
          this.failuresFor(report.completion).fault ??= { error };
      }
    }
    this.collectDrainCleanup(drain);
    const selected = (row: (typeof this.secondary)[number]) =>
      row.drain ? row.drain === drain : belongs(row.completion);
    const secondary = this.secondary.filter(selected);
    this.secondary = this.secondary.filter((row) => !selected(row));
    let ownFault: ExecutorFailure | undefined;
    for (const [completion, failures] of this.completionFailures) {
      if (belongs(completion)) ownFault ??= failures.fault;
    }
    if (
      this.fault &&
      (this.fault.drain
        ? this.fault.drain === drain
        : belongs(this.fault.completion))
    )
      ownFault ??= this.fault;
    const native: ExecutorFailure[] = [];
    for (const completion of this.syncCompletions) {
      if (!belongs(completion)) continue;
      this.syncCompletions.delete(completion);
      const failure = completion.nativeFailure;
      const stronger = this.completionFailures.get(completion);
      if (failure && !stronger?.original && !stronger?.fault)
        native.push(failure);
    }
    const nativePrimary = native.shift();
    const original = causes.shift();
    if (aborted && original) this.additional.push(original);
    this.additional.push(...causes);
    const notified = original ?? nativePrimary;
    if (notified) {
      try {
        this.onError(notified.error);
      } catch (error) {
        if (error !== notified.error) secondary.push({ error });
      }
    }
    for (const [completion, failures] of this.completionFailures) {
      if (!belongs(completion)) continue;
      const primary = failures.original ?? failures.fault;
      if (primary) completion.fail(primary.error);
      else if (failures.secondary)
        completion.failSecondary(failures.secondary.error);
      this.completionFailures.delete(completion);
    }
    const secondaryPrimary =
      !aborted && !original && !ownFault && !nativePrimary
        ? secondary.shift()
        : undefined;
    const primary =
      aborted ?? original ?? ownFault ?? nativePrimary ?? secondaryPrimary;
    for (const failure of [...causes, ...native, ...secondary])
      this.report(failure.error);
    if (aborted && original) this.report(original.error);
    if (aborted && nativePrimary) this.report(nativePrimary.error);
    if (!aborted && primary) {
      if (
        original ||
        ownFault ||
        nativePrimary ||
        secondaryPrimary?.input ||
        belongs(secondaryPrimary?.completion)
      )
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
