import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
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
test('one speaking turn at a time: a second reply waits, work does not', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'brain-pool-')),
    () => '2026-11-04'
  );
  const pool = new Pool({
    runner,
    limits: { respond: 2, heartbeat: 1, work: 2 },
    budget: async () => BUDGET,
    ledger,
    log: () => {},
  });
  assert.deepEqual(pool.lastTurnAt(), null);
  const first = await pool.start(turn('respond-1', 'respond'));
  const second = pool.start(turn('respond-2', 'respond'));
  await pool.start(turn('work-1', 'work'));
  assert.deepEqual(
    runner.started.map((started) => started.id),
    ['respond-1', 'work-1']
  );
  assert.deepEqual(pool.lastTurnAt(), null);
  runner.finish.get('respond-1')?.({
    status: 'success',
    result: 'replied',
    costUsd: 1.25,
    sessionId: 'session-1',
  });
  await first.done;
  assert.deepEqual(Number.isFinite(Date.parse(pool.lastTurnAt() ?? '')), true);
  await second;
  assert.deepEqual(
    runner.started.map((started) => started.id),
    ['respond-1', 'work-1', 'respond-2']
  );
  assert.deepEqual(await ledger.spentToday(), 1.25);
});
test('a turn gets the smaller of its per-run cap and what is left of the day', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'brain-pool-')),
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
  assert.deepEqual(runner.started[0]?.maxBudgetUsd, 1.5);
});
test('a spent day refuses the turn and frees its slots', async () => {
  const runner = new HeldRunner();
  const ledger = new SpendLedger(
    await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'brain-pool-')),
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
  await assert.rejects(
    () => pool.start(turn('respond-1', 'respond')),
    (error: unknown) =>
      error instanceof BudgetExceeded &&
      error.message.includes('daily budget of $10 is spent')
  );
  await assert.rejects(
    () => pool.start(turn('respond-2', 'respond')),
    BudgetExceeded
  );
  assert.deepEqual(runner.started, []);
  assert.deepEqual(pool.lastTurnAt(), null);
});

test('concurrent tiers reserve the remaining daily cap before starting runners', async () => {
  const directory = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-budget-reservation-')
  );
  try {
    const runner = new HeldRunner();
    const ledger = new SpendLedger(directory);
    const pool = new Pool({
      runner,
      limits: { work: 3, respond: 1, heartbeat: 1 },
      budget: async () => BUDGET,
      ledger,
      log: () => {},
    });
    const first = await pool.start(turn('first', 'work'));
    await assert.rejects(
      () => pool.start(turn('second', 'work')),
      BudgetExceeded
    );
    assert.equal(runner.started[0]?.maxBudgetUsd, 10);
    runner.finish.get('first')?.({
      status: 'success',
      result: '',
      costUsd: 2,
      sessionId: null,
    });
    await first.done;
    await pool.start(turn('third', 'work'));
    assert.equal(runner.started[1]?.maxBudgetUsd, 8);
  } finally {
    await nodeFs.rm(directory, { recursive: true });
  }
});

test('failed durable cost accounting refuses further spend instead of releasing unknown charges', async () => {
  const directory = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-budget-accounting-')
  );
  try {
    const ledger = new (class extends SpendLedger {
      override async record(_usd: number): Promise<number> {
        throw new Error('disk unavailable');
      }
    })(directory);
    const runner = new HeldRunner();
    const pool = new Pool({
      runner,
      limits: { work: 2 },
      budget: async () => BUDGET,
      ledger,
      log: () => {},
    });
    const first = await pool.start(turn('first', 'work'));
    runner.finish.get('first')?.({
      status: 'success',
      result: '',
      costUsd: 2,
      sessionId: null,
    });
    await assert.rejects(() => first.done, /disk unavailable/);
    await assert.rejects(
      () => pool.start(turn('second', 'work')),
      /accounting unavailable/
    );
    assert.equal(runner.started.length, 1);
  } finally {
    await nodeFs.rm(directory, { recursive: true });
  }
});

test('unknown timeout cost consumes the admitted cap durably while releasing slots', async (t) => {
  const directory = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-unknown-spend-')
  );
  t.after(() => nodeFs.rm(directory, { recursive: true, force: true }));
  const ledger = new SpendLedger(directory);
  const runner = new HeldRunner();
  const pool = new Pool({
    runner,
    limits: { work: 1 },
    budget: async () => BUDGET,
    ledger,
    log() {},
  });
  const run = await pool.start(turn('stuck', 'work'));
  runner.finish.get('stuck')?.({
    status: 'aborted',
    result: 'inactivity',
    costUsd: 0,
    costIncomplete: true,
    sessionId: null,
  });
  await run.done;
  assert.deepEqual(pool.active(), []);
  assert.equal(await new SpendLedger(directory).spentToday(), 10);
  await assert.rejects(() => pool.start(turn('next', 'work')), BudgetExceeded);
});

test('a rejected runner retains unknown spend across a new ledger instance', async (t) => {
  const directory = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-rejected-spend-')
  );
  t.after(() => nodeFs.rm(directory, { recursive: true, force: true }));
  const failure = Promise.withResolvers<Outcome>();
  const pool = new Pool({
    runner: {
      start: () => ({
        events: new AsyncQueue<RunEvent>(),
        inject() {},
        abort() {},
        done: failure.promise,
      }),
    },
    limits: { work: 1 },
    budget: async () => BUDGET,
    ledger: new SpendLedger(directory),
    log() {},
  });
  const run = await pool.start(turn('failed', 'work'));
  failure.reject(new Error('runner failed'));
  await assert.rejects(run.done, /runner failed/);
  assert.deepEqual(pool.active(), []);
  assert.equal(await new SpendLedger(directory).spentToday(), 10);
  await assert.rejects(() => pool.start(turn('retry', 'work')), BudgetExceeded);
});
