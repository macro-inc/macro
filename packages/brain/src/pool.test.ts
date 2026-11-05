import { assertEquals, assertRejects } from '@std/assert';
import { SpendLedger } from './budget.ts';
import { AsyncQueue } from './channel.ts';
import { BudgetExceeded, Pool } from './pool.ts';
import type { Outcome, RunEvent, RunHandle, Runner, Turn } from './runner.ts';

const BUDGET = {
  perRunUsd: { respond: 3, heartbeat: 3, work: 20 },
  perDayUsd: 10,
};

/** A runner whose turns finish when the test says so. */
class HeldRunner implements Runner {
  readonly started: Turn[] = [];
  readonly finish = new Map<string, (outcome: Outcome) => void>();

  start(turn: Turn): RunHandle {
    this.started.push(turn);
    const done = Promise.withResolvers<Outcome>();
    this.finish.set(turn.id, done.resolve);
    return {
      events: new AsyncQueue<RunEvent>(),
      inject: () => {},
      abort: () => {},
      done: done.promise,
    };
  }
}

const turn = (id: string, tier: Turn['tier']) => ({
  id,
  tier,
  prompt: 'hi',
  system: 'you are Ada',
  cwd: '/tmp',
  model: 'claude-opus-5-5',
  env: {},
});

Deno.test('one speaking turn at a time: a second reply waits, work does not', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await Deno.makeTempDir({ prefix: 'brain-pool-' }),
    () => '2026-11-04'
  );
  const pool = new Pool({
    runner,
    limits: { respond: 2, heartbeat: 1, work: 2 },
    budget: async () => BUDGET,
    ledger,
    log: () => {},
  });

  const first = await pool.start(turn('respond-1', 'respond'));
  const second = pool.start(turn('respond-2', 'respond'));
  await pool.start(turn('work-1', 'work'));

  assertEquals(
    runner.started.map((started) => started.id),
    ['respond-1', 'work-1']
  );

  runner.finish.get('respond-1')?.({
    status: 'success',
    result: 'replied',
    costUsd: 1.25,
    sessionId: 'session-1',
  });
  await first.done;
  await second;

  assertEquals(
    runner.started.map((started) => started.id),
    ['respond-1', 'work-1', 'respond-2']
  );
  assertEquals(await ledger.spentToday(), 1.25);
});

Deno.test('a turn gets the smaller of its per-run cap and what is left of the day', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await Deno.makeTempDir({ prefix: 'brain-pool-' }),
    () => '2026-11-04'
  );
  await ledger.record(8.5);
  const pool = new Pool({
    runner,
    limits: { respond: 1, heartbeat: 1, work: 1 },
    budget: async () => BUDGET,
    ledger,
    log: () => {},
  });

  await pool.start(turn('work-1', 'work'));

  assertEquals(runner.started[0]?.maxBudgetUsd, 1.5);
});

Deno.test('a spent day refuses the turn and frees its slots', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await Deno.makeTempDir({ prefix: 'brain-pool-' }),
    () => '2026-11-04'
  );
  await ledger.record(10);
  const pool = new Pool({
    runner,
    limits: { respond: 1, heartbeat: 1, work: 1 },
    budget: async () => BUDGET,
    ledger,
    log: () => {},
  });

  await assertRejects(
    () => pool.start(turn('respond-1', 'respond')),
    BudgetExceeded,
    'daily budget of $10 is spent'
  );
  await assertRejects(
    () => pool.start(turn('respond-2', 'respond')),
    BudgetExceeded
  );
  assertEquals(runner.started, []);
});
