// Admission for turns: a concurrency limit per tier, one speaking turn at a
// time (respond and heartbeat talk; work stays quiet until its report), and
// the spend caps. A turn waits for its slots, runs with the smaller of its
// tier's per-run cap and what is left of the day, and records its cost.
import type { Budget, SpendLedger } from './budget.ts';
import type { RunHandle, Runner, Tier, Turn } from './runner.ts';

/** A FIFO counting semaphore. */
export class Semaphore {
  private readonly waiting: (() => void)[] = [];
  private held = 0;

  constructor(private readonly limit: number) {}

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
  limits: Record<Tier, number>;
  budget(): Promise<Budget>;
  ledger: SpendLedger;
  log(line: object): void;
};

export class Pool {
  private readonly tiers: Record<Tier, Semaphore>;
  private readonly speaking = new Semaphore(1);
  private readonly running = new Map<
    string,
    { tier: Tier; startedAt: string }
  >();

  constructor(private readonly deps: PoolDeps) {
    this.tiers = {
      respond: new Semaphore(deps.limits.respond),
      heartbeat: new Semaphore(deps.limits.heartbeat),
      work: new Semaphore(deps.limits.work),
    };
  }

  /** Turns running now, for health and prompts. */
  active(): { id: string; tier: Tier; startedAt: string }[] {
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
  async start(turn: Omit<Turn, 'maxBudgetUsd'>): Promise<RunHandle> {
    const releaseTier = await this.tiers[turn.tier].acquire();
    const releaseSpeaking = SPEAKING[turn.tier]
      ? await this.speaking.acquire()
      : () => {};
    const release = () => {
      releaseSpeaking();
      releaseTier();
      this.running.delete(turn.id);
    };

    let handle: RunHandle;
    try {
      const budget = await this.deps.budget();
      const remaining =
        budget.perDayUsd - (await this.deps.ledger.spentToday());
      if (remaining <= 0) {
        throw new BudgetExceeded(
          `daily budget of $${budget.perDayUsd} is spent`
        );
      }
      const maxBudgetUsd = Math.min(budget.perRunUsd[turn.tier], remaining);
      handle = this.deps.runner.start({ ...turn, maxBudgetUsd });
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
        release();
        const spent = await this.deps.ledger.record(outcome.costUsd);
        this.deps.log({
          turn: turn.id,
          tier: turn.tier,
          status: outcome.status,
          cost_usd: outcome.costUsd,
          spent_today_usd: spent,
        });
        return outcome;
      },
      (error) => {
        release();
        throw error;
      }
    );
    return { ...handle, done };
  }
}
