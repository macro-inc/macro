import type { IViewEffectMsg } from '@macro-inc/collaboration/session/abi.generated';
import type { ExecutorFailure } from '@macro-inc/collaboration/session/executor';
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
  private reported: ReportedFailure[] = [];
  private secondary: ExecutorFailure[] = [];
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

  recordSecondary(error: unknown): void {
    this.secondary.push({ error });
  }

  takeFailure(): NativeCallbackFailure | undefined {
    this.dispatcher.assertRootAdmission();
    return this.additional.shift();
  }

  beforeConsume(flags: number): void {
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
          this.fault ??= {
            error: new Error(
              'Native callback failure has no matching issued cause'
            ),
          };
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
          });
      }
      if (!(flags & (Flag.View | Flag.Io | Flag.Error | Flag.NeedPeerIds))) {
        if (this.pending.some(({ lease }) => lease.current))
          throw new Error('Native callback failure lacks its output flags');
        this.releasePacket();
      }
    } catch (error) {
      this.fault ??= { error };
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
      this.fault ??= { error };
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
        this.fault ??= { error };
      }
    }
  }

  afterDrain(aborted?: ExecutorFailure): void {
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
        if (cause) causes.push({ ...report, error: cause.error });
        else
          this.fault ??= {
            error: new Error('Native callback cause disappeared before drain'),
          };
      } catch (error) {
        this.fault ??= { error };
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
    const primary = aborted ?? original ?? this.fault ?? secondary.shift();
    for (const failure of [...causes, ...secondary]) this.report(failure.error);
    if (aborted && original) this.report(original.error);
    if (!aborted && primary) throw primary.error;
  }

  private report(error: unknown): void {
    try {
      Telemetry.error(error, { surface: 'editor.command.secondary' });
    } catch {
      /* A secondary reporter cannot replace the original thrown value. */
    }
  }
}
