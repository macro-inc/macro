import { expect, test } from 'bun:test';
import type { Agent, WakeContext, Woke } from '@macro-inc/muppet/core/agent';
import { fixedClock, join, memoryDisk } from '../../context/test/fakes.ts';
import {
  budgeted,
  budgetNotice,
  budgetRefused,
  type Caps,
  capped,
  capsOf,
  defaultCaps,
  fileLedger,
  recordSpend,
} from '../budget.ts';

const timeZone = 'America/New_York';
const directory = '/agent/state/run/budget';
const caps: Caps = { perRunUsd: 5, perDayUsd: 10 };

const wakeContext = (name = 'conversations'): WakeContext => ({
  request: 'hi',
  systemPrompt: '',
  event: { name, payload: {} },
  state: {
    code: {
      catalog: '',
      script: { file: '', name: '' },
      execute: async () => ({ kind: 'failed', error: 'no', logs: '' }),
      describe: async () => '',
    },
  },
});

/** An agent that counts its wakes and reports what it spent, as Claude's `record` does. */
const setup = (start = '2026-11-09T15:00:00Z') => {
  const disk = memoryDisk();
  const clock = fixedClock(start);
  const ledger = fileLedger({ disk, join, directory });
  const record = recordSpend({ ledger, clock, timeZone });
  const woken: string[] = [];
  const inner: Agent = {
    wake: async ({ event }): Promise<Woke> => {
      woken.push(event.name);
      return { kind: 'done', reply: 'ok' };
    },
  };
  const agent = budgeted({ agent: inner, ledger, caps, clock, timeZone });
  return { disk, clock, ledger, record, woken, agent };
};

test('caps come from agent.json, or the documented defaults', () => {
  expect(defaultCaps).toEqual({ perRunUsd: 5, perDayUsd: 50 });
  expect(capsOf({})).toEqual(defaultCaps);
  expect(capsOf({ budgetUsdPerRun: 2, budgetUsdPerDay: 20 })).toEqual({
    perRunUsd: 2,
    perDayUsd: 20,
  });
});

test("a run's budget is the lower of its profile's and the per-run cap", () => {
  const profile = capped(
    (event: { readonly name: string }) => ({
      budgetUsd: event.name === 'schedules' ? 10 : 3,
      timeoutMs: 1,
    }),
    5
  );
  expect(profile({ name: 'schedules' })).toEqual({
    budgetUsd: 5,
    timeoutMs: 1,
  });
  expect(profile({ name: 'conversations' })).toEqual({
    budgetUsd: 3,
    timeoutMs: 1,
  });
});

test('every finished run is a line in the ledger for the owner’s day; a record with no cost is none', async () => {
  const { disk, record, ledger } = setup('2026-11-10T03:00:00Z');
  await record({ event: 'conversations', phase: 'start', session_id: 's' });
  await record({
    event: 'conversations',
    session_id: 's',
    result: 'success',
    cost_usd: 1.25,
  });
  await record({ event: 'schedules', result: 'timeout', ms: 5 });
  // 03:00 UTC is still the 9th in New York.
  const day = Temporal.PlainDate.from('2026-11-09');
  expect(await ledger.spent(day)).toBe(1.25);
  expect(disk.files.get(`${directory}/2026-11-09.jsonl`)).toBe(
    '{"at":"2026-11-10T03:00:00Z","event":"conversations","costUsd":1.25,"sessionId":"s"}\n'
  );
});

test('under the daily cap a wake goes through; at it, the wake is refused and the owner told once a day', async () => {
  const { record, woken, agent, clock } = setup();
  expect(await agent.wake(wakeContext())).toEqual({
    kind: 'done',
    reply: 'ok',
  });
  await record({ event: 'conversations', result: 'success', cost_usd: 6 });
  expect(await agent.wake(wakeContext())).toEqual({
    kind: 'done',
    reply: 'ok',
  });
  await record({ event: 'conversations', result: 'success', cost_usd: 4 });

  const first = await agent.wake(wakeContext('schedules'));
  const second = await agent.wake(wakeContext());
  expect(woken).toEqual(['conversations', 'conversations']);
  expect(first.kind).toBe('failed');
  expect(second.kind).toBe('failed');
  if (first.kind !== 'failed' || second.kind !== 'failed') return;
  expect(first.error).toStartWith('budget');
  expect(second.error).toStartWith('budget');
  const notice = budgetNotice(first.error);
  expect(notice).toContain('$10.00');
  expect(notice).toContain('budgetUsdPerDay');
  expect(budgetNotice(second.error)).toBeUndefined();
  expect(budgetNotice('timed out')).toBeUndefined();
  expect([first.error, second.error].every(budgetRefused)).toBe(true);
  expect(budgetRefused('timed out')).toBe(false);

  // The owner's next day starts with nothing spent.
  clock.advance(14 * 60 * 60_000);
  expect(await agent.wake(wakeContext())).toEqual({
    kind: 'done',
    reply: 'ok',
  });
});

test('the ledger and the notice survive a restart: a new process neither forgets the spend nor tells again', async () => {
  const { disk, record, clock } = setup();
  await record({ event: 'conversations', result: 'success', cost_usd: 11 });
  const ledger = fileLedger({ disk, join, directory });
  const first = budgeted({
    agent: { wake: async () => ({ kind: 'done', reply: '' }) },
    ledger,
    caps,
    clock,
    timeZone,
  });
  const refused = await first.wake(wakeContext());
  expect(refused.kind === 'failed' && budgetNotice(refused.error)).toBeTruthy();
  const again = budgeted({
    agent: { wake: async () => ({ kind: 'done', reply: '' }) },
    ledger: fileLedger({ disk, join, directory }),
    caps,
    clock,
    timeZone,
  });
  const later = await again.wake(wakeContext());
  expect(later.kind).toBe('failed');
  if (later.kind === 'failed')
    expect(budgetNotice(later.error)).toBeUndefined();
});

test('two wakes refused at once tell the owner once', async () => {
  const { record, agent } = setup();
  await record({ event: 'conversations', result: 'success', cost_usd: 10 });
  const both = await Promise.all([
    agent.wake(wakeContext()),
    agent.wake(wakeContext()),
  ]);
  const notices = both.flatMap((woke) =>
    woke.kind === 'failed' ? [budgetNotice(woke.error)] : []
  );
  expect(notices.filter((notice) => notice !== undefined)).toHaveLength(1);
});

test('a ledger line that does not parse is skipped, not counted', async () => {
  const { disk, ledger } = setup();
  disk.files.set(
    `${directory}/2026-11-09.jsonl`,
    'garbage\n{"at":"2026-11-09T15:00:00Z","event":"x","costUsd":2}\n'
  );
  expect(await ledger.spent(Temporal.PlainDate.from('2026-11-09'))).toBe(2);
});
