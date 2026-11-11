import * as nodeFs from 'node:fs/promises';
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
type LedgerFile = {
  day: string;
  spentUsd: number;
};
/** Today's spend, persisted in `<dir>/spend.json` so a restart keeps the count. */
export class SpendLedger {
  private readonly dir: string;
  private readonly today: () => string;
  private writing: Promise<number> = Promise.resolve(0);
  constructor(
    dir: string,
    today: () => string = () => new Date().toISOString().slice(0, 10)
  ) {
    this.dir = dir;
    this.today = today;
  }
  private get file() {
    return join(this.dir, 'spend.json');
  }
  async spentToday(): Promise<number> {
    return this.spentOn(this.today());
  }
  private async spentOn(day: string): Promise<number> {
    try {
      const ledger = JSON.parse(
        await nodeFs.readFile(this.file, 'utf8')
      ) as LedgerFile;
      return ledger.day === day ? ledger.spentUsd : 0;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return 0;
      throw error;
    }
  }
  record(usd: number): Promise<number> {
    return this.adjust(usd).then((ledger) => ledger.spentUsd);
  }
  /** Debit before starting execution; a crash leaves its admitted cap charged. */
  async reserve(
    usd: number,
    dailyLimitUsd: number
  ): Promise<{
    capUsd: number;
    settle(
      actualUsd: number
    ): Promise<{ spentTodayUsd: number; accountedUsd: number }>;
  }> {
    if (!Number.isFinite(usd) || usd <= 0)
      throw new BudgetError('invalid admission cap');
    if (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd <= 0)
      throw new BudgetError('invalid daily limit');
    let capUsd = 0;
    const admission = await this.adjust((current) => {
      const remaining = dailyLimitUsd - current;
      if (remaining <= 0)
        throw new BudgetError(`daily budget of $${dailyLimitUsd} is spent`);
      capUsd = Math.min(usd, remaining);
      return capUsd;
    });
    let settled:
      | Promise<{ spentTodayUsd: number; accountedUsd: number }>
      | undefined;
    return {
      capUsd,
      settle: (actualUsd) => {
        if (!Number.isFinite(actualUsd) || actualUsd < 0)
          return Promise.reject(new BudgetError('invalid final cost'));
        // Memoize even a rejected refund: never retry a potentially applied credit.
        settled ??= this.adjust(actualUsd - capUsd, admission.day).then(
          (ledger) => ({
            spentTodayUsd: ledger.spentUsd,
            accountedUsd: ledger.day === admission.day ? actualUsd : capUsd,
          })
        );
        return settled;
      },
    };
  }
  private adjust(
    usd: number | ((current: number) => number),
    admissionDay?: string
  ): Promise<LedgerFile> {
    const next = this.writing.then(async () => {
      const day = this.today();
      const current = await this.spentOn(day);
      // A completed old-day turn can never credit a later day's budget.
      if (admissionDay !== undefined && admissionDay !== day)
        return { day, spentUsd: current };
      const spentUsd =
        current + (typeof usd === 'function' ? usd(current) : usd);
      await nodeFs.mkdir(this.dir, { recursive: true });
      const ledger: LedgerFile = { day, spentUsd };
      await nodeFs.writeFile(`${this.file}.tmp`, JSON.stringify(ledger));
      await nodeFs.rename(`${this.file}.tmp`, this.file);
      return ledger;
    });
    this.writing = next.then((ledger) => ledger.spentUsd).catch(() => 0);
    return next;
  }
}
