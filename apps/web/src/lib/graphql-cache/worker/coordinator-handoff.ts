import type { CacheTelemetryRecorderLike } from '../telemetry';
import type { CacheReadState } from './coordinator-protocol';

export const OWNER_HANDOFF_READ_TIMEOUT_MS = 1_000;

export type CacheReadAvailability = Readonly<{
  ownerEpoch: number;
  state: CacheReadState;
}>;

/** Bounds foreground read availability, never engine lifetime or lock ownership. */
export class CoordinatorHandoff {
  private active:
    | {
        ownerEpoch: number;
        startedAt: number;
        resumed: boolean;
      }
    | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private budget: object | undefined;
  private current: CacheReadAvailability | undefined;
  private parked = false;

  constructor(
    private readonly options: {
      timeoutMs: number;
      setTimeout: typeof globalThis.setTimeout;
      clearTimeout: typeof globalThis.clearTimeout;
      now: () => number;
      telemetry: CacheTelemetryRecorderLike;
      onChange: (availability: CacheReadAvailability) => void;
    }
  ) {}

  get readState(): CacheReadAvailability | undefined {
    return this.current;
  }

  get transitioning(): boolean {
    return (
      this.active !== undefined ||
      (this.current !== undefined && this.current.state !== 'ready')
    );
  }

  start(ownerEpoch: number, visible = true): void {
    if (!this.active) {
      this.active = {
        ownerEpoch,
        startedAt: this.options.now(),
        resumed: this.parked,
      };
      this.options.telemetry.record({
        name: 'graphql_cache.owner',
        operationCategory: 'lifecycle',
        outcome: 'graceful',
        ownerEvent: this.parked
          ? 'unpark-started'
          : visible
            ? 'visibility-handoff-started'
            : 'park-started',
      });
    }
    this.parked = false;
    const active = this.active;
    active.ownerEpoch = ownerEpoch;
    if (!visible) {
      this.clearBudget();
      this.update(ownerEpoch, 'waiting');
      return;
    }
    // Changes of candidate must not reset an exhausted foreground budget.
    if (this.current?.state === 'blocked') {
      this.update(ownerEpoch, 'blocked');
      return;
    }
    this.update(ownerEpoch, 'waiting');
    if (this.timer !== undefined) return;
    const budget = {};
    this.budget = budget;
    const startedAt = this.options.now();
    this.timer = this.options.setTimeout(() => {
      if (this.active !== active || this.budget !== budget) return;
      this.timer = undefined;
      this.budget = undefined;
      this.options.telemetry.record({
        name: 'graphql_cache.owner',
        operationCategory: 'lifecycle',
        outcome: 'error',
        errorCode: 'timeout',
        ownerEvent: 'visibility-handoff-blocked',
        durationMs: this.options.now() - startedAt,
      });
      this.update(active.ownerEpoch, 'blocked');
    }, this.options.timeoutMs);
  }

  park(ownerEpoch: number): void {
    if (this.parked && this.current?.ownerEpoch === ownerEpoch) return;
    const startedAt = this.active?.startedAt;
    this.cancel();
    this.parked = true;
    this.update(ownerEpoch, 'waiting');
    this.options.telemetry.record({
      name: 'graphql_cache.owner',
      operationCategory: 'lifecycle',
      outcome: 'graceful',
      ownerEvent: 'parked',
      durationMs:
        startedAt === undefined ? undefined : this.options.now() - startedAt,
    });
  }

  ready(ownerEpoch: number): void {
    if (this.active) {
      this.options.telemetry.record({
        name: 'graphql_cache.owner',
        operationCategory: 'lifecycle',
        outcome: 'success',
        ownerEvent: this.active.resumed
          ? 'unpark-completed'
          : 'visibility-handoff-completed',
        durationMs: this.options.now() - this.active.startedAt,
      });
    }
    this.cancel();
    this.parked = false;
    if (this.current) this.update(ownerEpoch, 'ready');
  }

  cancel(): void {
    this.clearBudget();
    this.active = undefined;
    // Failure is not readiness. Keep waiting/bypass until an owner is usable.
  }

  private clearBudget(): void {
    if (this.timer !== undefined) this.options.clearTimeout(this.timer);
    this.timer = undefined;
    this.budget = undefined;
  }

  private update(ownerEpoch: number, state: CacheReadState): void {
    if (this.current?.ownerEpoch === ownerEpoch && this.current.state === state)
      return;
    this.current = { ownerEpoch, state };
    this.options.onChange(this.current);
  }
}
