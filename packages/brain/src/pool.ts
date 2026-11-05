// Admission for turns: a concurrency limit per tier, one speaking turn at a
// time (respond and heartbeat talk; work stays quiet until its report), and
// the spend caps. A turn waits for its slots, runs with the smaller of its
// tier's per-run cap and what is left of the day, and records its cost.
import type { Budget, SpendLedger } from './budget.ts';
import type {
  Outcome,
  RunHandle,
  Runner,
  Tier,
  Turn,
  TurnRequest,
} from './runner.ts';
/** A FIFO counting semaphore. */
export class Semaphore {
  private readonly limit: number;
  private readonly waiting: (() => void)[] = [];
  private held = 0;
  constructor(limit: number) {
    this.limit = limit;
  }
  async acquire(): Promise<() => void> {
    if (this.held >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.held++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.held--;
    };
  }
}
export class BudgetExceeded extends Error {}
const SPEAKING: Record<Tier, boolean> = {
  respond: true,
  heartbeat: true,
  work: false,
};
export type PoolDeps = {
  runner: Runner;
  speaking?: Record<Tier, boolean>;
  beforeTurn?(turn: TurnRequest): TurnRequest | Promise<TurnRequest>;
  afterTurn?(turn: Turn, outcome: Outcome): void | Promise<void>;
  limits: Record<Tier, number>;
  budget(): Promise<Budget>;
  ledger: SpendLedger;
  log(line: object): void;
};
export class Pool {
  private readonly deps: PoolDeps;
  private readonly tiers: Record<Tier, Semaphore>;
  private readonly speaking = new Semaphore(1);
  private lastCompletedAt: string | null = null;
  private readonly running = new Map<
    string,
    {
      tier: Tier;
      startedAt: string;
    }
  >();
  constructor(deps: PoolDeps) {
    this.deps = deps;
    this.tiers = Object.fromEntries(
      Object.entries(deps.limits).map(([tier, limit]) => [
        tier,
        new Semaphore(limit),
      ])
    );
  }
  /** Latest completed turn across all tiers, for the computer health report. */
  lastTurnAt(): string | null {
    return this.lastCompletedAt;
  }
  /** Turns running now, for health and prompts. */
  active(): {
    id: string;
    tier: Tier;
    startedAt: string;
  }[] {
    return [...this.running].map(([id, run]) => ({ id, ...run }));
  }
  /** Run `speak` while holding the speaking gate (a work run's report). */
  async speak<Result>(speak: () => Promise<Result>): Promise<Result> {
    const release = await this.speaking.acquire();
    try {
      return await speak();
    } finally {
      release();
    }
  }
  /** Wait for slots, then start the turn under the budget. Throws `BudgetExceeded` when the day is spent. */
  async start(request: TurnRequest): Promise<RunHandle> {
    const turn = (await this.deps.beforeTurn?.(request)) ?? request;
    const semaphore = this.tiers[turn.tier];
    if (!semaphore) throw new Error(`unconfigured tier: ${turn.tier}`);
    const releaseTier = await semaphore.acquire();
    const releaseSpeaking =
      (this.deps.speaking?.[turn.tier] ?? SPEAKING[turn.tier])
        ? await this.speaking.acquire()
        : () => {};
    const release = () => {
      releaseSpeaking();
      releaseTier();
      this.running.delete(turn.id);
    };
    let handle: RunHandle;
    let admitted: Turn;
    try {
      const budget = await this.deps.budget();
      const remaining =
        budget.perDayUsd - (await this.deps.ledger.spentToday());
      if (remaining <= 0) {
        throw new BudgetExceeded(
          `daily budget of $${budget.perDayUsd} is spent`
        );
      }
      const cap = budget.perRunUsd[turn.tier];
      if (!cap || cap <= 0)
        throw new Error(`missing budget for tier: ${turn.tier}`);
      if (
        turn.maxBudgetUsd !== undefined &&
        (!Number.isFinite(turn.maxBudgetUsd) || turn.maxBudgetUsd <= 0)
      )
        throw new Error('turn budget must be positive and finite');
      const maxBudgetUsd = Math.min(cap, remaining, turn.maxBudgetUsd ?? cap);
      admitted = { ...turn, maxBudgetUsd };
      handle = this.deps.runner.start(admitted);
    } catch (error) {
      release();
      throw error;
    }
    this.running.set(turn.id, {
      tier: turn.tier,
      startedAt: new Date().toISOString(),
    });
    const done = handle.done.then(
      async (outcome) => {
        try {
          const spent = await this.deps.ledger.record(outcome.costUsd);
          this.deps.log({
            turn: turn.id,
            tier: turn.tier,
            status: outcome.status,
            cost_usd: outcome.costUsd,
            spent_today_usd: spent,
          });
          await this.deps.afterTurn?.(admitted, outcome);
          return outcome;
        } finally {
          this.lastCompletedAt = new Date().toISOString();
          release();
        }
      },
      async (error) => {
        try {
          await this.deps.afterTurn?.(admitted, {
            status: 'error',
            result: '',
            costUsd: 0,
            sessionId: null,
          });
        } finally {
          this.lastCompletedAt = new Date().toISOString();
          release();
        }
        throw error;
      }
    );
    return { ...handle, done };
  }
}
