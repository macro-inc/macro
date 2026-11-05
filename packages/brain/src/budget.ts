// Spend caps from config/budget.json, and the day's ledger under cache/.
// The ledger is local: a moved computer starts the day fresh, which errs
// toward spending at most one extra day's cap.
import { join } from 'node:path';
import type { Tier } from './runner.ts';

export type Budget = {
  perRunUsd: Record<Tier, number>;
  perDayUsd: number;
};

export class BudgetError extends Error {}

const positive = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BudgetError(
      `config/budget.json: ${name} must be a positive number`
    );
  }
  return value;
};

export function parseBudget(raw: unknown): Budget {
  if (typeof raw !== 'object' || raw === null) {
    throw new BudgetError('config/budget.json must be an object');
  }
  const { perRunUsd, perDayUsd } = raw as {
    perRunUsd?: Record<string, unknown>;
    perDayUsd?: unknown;
  };
  if (typeof perRunUsd !== 'object' || perRunUsd === null) {
    throw new BudgetError('config/budget.json: perRunUsd must be an object');
  }
  return {
    perRunUsd: {
      ...Object.fromEntries(
        Object.entries(perRunUsd).map(([tier, cap]) => [
          tier,
          positive(cap, `perRunUsd.${tier}`),
        ])
      ),
      respond: positive(perRunUsd.respond, 'perRunUsd.respond'),
      heartbeat: positive(perRunUsd.heartbeat, 'perRunUsd.heartbeat'),
      work: positive(perRunUsd.work, 'perRunUsd.work'),
    },
    perDayUsd: positive(perDayUsd, 'perDayUsd'),
  };
}

type LedgerFile = { day: string; spentUsd: number };

/** Today's spend, persisted in `<dir>/spend.json` so a restart keeps the count. */
export class SpendLedger {
  constructor(
    private readonly dir: string,
    private readonly today: () => string = () =>
      new Date().toISOString().slice(0, 10)
  ) {}

  private get file() {
    return join(this.dir, 'spend.json');
  }

  async spentToday(): Promise<number> {
    try {
      const ledger = JSON.parse(
        await Deno.readTextFile(this.file)
      ) as LedgerFile;
      return ledger.day === this.today() ? ledger.spentUsd : 0;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return 0;
      throw error;
    }
  }

  async record(usd: number): Promise<number> {
    const spentUsd = (await this.spentToday()) + usd;
    await Deno.mkdir(this.dir, { recursive: true });
    const ledger: LedgerFile = { day: this.today(), spentUsd };
    await Deno.writeTextFile(this.file, JSON.stringify(ledger));
    return spentUsd;
  }
}
