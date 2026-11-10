import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
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
import type { NativeEnterDispatcher } from './native-enter';

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

  constructor(
    private readonly session: EditorSession,
    private readonly dispatcher: NativeEnterDispatcher,
    private readonly owner: bigint,
    private readonly onError: (error: unknown) => void
  ) {}

  assertLocalAdmission(): void {
    this.dispatcher.assertRootAdmission();
    this.assertAttached();
    if (this.fault) throw this.fault.error;
  }
  beginTeardown(): void {
    this.detached = true;
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
    this.currentCompletion = undefined;
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
