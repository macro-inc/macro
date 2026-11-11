import { describe, expect, test } from 'bun:test';
import type { WakeContext, Woke } from '../../../core/agent.ts';
import { simple } from '../../../runtimes/simple.ts';
import { scripts } from '../../../runtimes/test/scripts.ts';
import type { Clock } from '../../time/index.ts';
import { type Fired, memoryStore, scheduler, scheduling } from '../index.ts';

/** A clock whose sleep moves time forward at once. */
const fakeClock = (start: string): Clock => {
  let now = Temporal.Instant.from(start);
  return {
    now: () => now,
    sleep: async (ms) => {
      now = now.add({ milliseconds: ms });
    },
  };
};

/** The first `count` firings, then stops the scheduler. */
const take = async (
  fired: AsyncIterable<Fired>,
  count: number,
  stop: AbortController
): Promise<Fired[]> => {
  const got: Fired[] = [];
  for await (const firing of fired) {
    got.push(firing);
    if (got.length === count) break;
  }
  stop.abort();
  return got;
};

describe('scheduler', () => {
  test('fires an every on its length after each run, with its data', async () => {
    const stop = new AbortController();
    const schedules = scheduler({
      store: memoryStore(),
      clock: fakeClock('2026-11-09T09:00:00Z'),
      tz: 'UTC',
      signal: stop.signal,
    });
    await schedules.set('poll', { every: '10m', data: { inbox: 'work' } });

    expect(await take(schedules.fired, 3, stop)).toEqual([
      { name: 'poll', due: '2026-11-09T09:00:00Z', data: { inbox: 'work' } },
      { name: 'poll', due: '2026-11-09T09:10:00Z', data: { inbox: 'work' } },
      { name: 'poll', due: '2026-11-09T09:20:00Z', data: { inbox: 'work' } },
    ]);
  });

  test('fires rules and ats in order, sleeping in between', async () => {
    const stop = new AbortController();
    const schedules = scheduler({
      store: memoryStore(),
      clock: fakeClock('2026-11-09T09:30:00Z'),
      tz: 'America/New_York',
      signal: stop.signal,
    });
    await schedules.set('hourly', { rule: 'FREQ=HOURLY;BYMINUTE=0' });
    await schedules.set('reminder', {
      at: '2026-11-09T10:15:00Z',
      data: 'call back',
    });

    const got = await take(schedules.fired, 3, stop);
    expect(got.map(({ name, due }) => `${due} ${name}`)).toEqual([
      '2026-11-09T10:00:00Z hourly',
      '2026-11-09T10:15:00Z reminder',
      '2026-11-09T11:00:00Z hourly',
    ]);
  });

  test("refuses what doesn't mean anything, and says what it changed", async () => {
    const schedules = scheduler({
      store: memoryStore(),
      clock: fakeClock('2026-11-09T09:00:00Z'),
      tz: 'UTC',
    });
    expect(await schedules.set('Bad Name', { every: '1m' })).toMatchObject({
      kind: 'invalid',
    });
    expect(
      await schedules.set('daily', { rule: 'FREQ=DAILY;BYHOUR=25' })
    ).toEqual({
      kind: 'invalid',
      error: 'rule: rrule BYHOUR: 25 is not 0 to 23',
    });
    expect(await schedules.pause('nope')).toEqual({
      kind: 'unknown',
      name: 'nope',
    });

    await schedules.set('daily', {
      rule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      why: 'standup',
    });
    expect(await schedules.pause('daily')).toMatchObject({
      kind: 'changed',
      status: { name: 'daily', paused: true, next: null },
    });
    expect(await schedules.resume('daily')).toMatchObject({
      kind: 'changed',
      status: { paused: false, next: '2026-11-09T09:00:00Z' },
    });
    expect(await schedules.list()).toMatchObject([
      { name: 'daily', schedule: { why: 'standup' } },
    ]);
    expect(await schedules.remove('daily')).toEqual({
      kind: 'removed',
      name: 'daily',
    });
    expect(await schedules.remove('daily')).toEqual({
      kind: 'unknown',
      name: 'daily',
    });
    expect(await schedules.list()).toEqual([]);
  });

  test('passes over firings that are too late, and counts them', async () => {
    const store = memoryStore({
      hourly: {
        schedule: { rule: 'FREQ=HOURLY;BYMINUTE=0' },
        run: { due: '2026-11-09T07:00:00Z' },
      },
    });
    const stop = new AbortController();
    const schedules = scheduler({
      store,
      clock: fakeClock('2026-11-09T09:30:00Z'),
      tz: 'UTC',
      signal: stop.signal,
    });

    const [first] = await take(schedules.fired, 1, stop);
    expect(first?.due).toBe('2026-11-09T10:00:00Z');
    // 08:00 and 09:00 were both too late by 09:30.
    expect((await store.read()).hourly?.run.missed).toBe(2);
  });
});

test('scheduling wakes the agent from a handler on the schedules source', async () => {
  const stop = new AbortController();
  const wakes: string[] = [];
  const scheduled = scheduling({
    store: memoryStore(),
    clock: fakeClock('2026-11-09T09:00:00Z'),
    tz: 'UTC',
    signal: stop.signal,
  });
  await scheduled.decorations.schedules.set('check-in', {
    every: '1h',
    data: 'How is it going?',
  });

  await scheduled
    .decorate({
      agent: {
        wake: async ({
          request,
          event,
          systemPrompt,
        }: WakeContext): Promise<Woke> => {
          wakes.push(`${request} ${JSON.stringify(event.payload)}`);
          expect(systemPrompt).toContain('setSchedule');
          if (wakes.length === 2) stop.abort();
          return { kind: 'done', reply: 'ok' };
        },
      },
    })
    .on(
      (sources) => sources.schedules,
      async ({ name, data }, { wake }) => {
        if (name === 'check-in') await wake(String(data));
      }
    )
    .on(
      (sources) => sources.hooks.failed,
      async ({ kind, error }) => {
        wakes.push(`failed ${kind} ${error}`);
      }
    )
    .run(simple({ systemPrompt: 'base', ...scripts() }));

  expect(wakes).toEqual([
    'How is it going? {"name":"check-in","due":"2026-11-09T09:00:00Z","data":"How is it going?"}',
    'How is it going? {"name":"check-in","due":"2026-11-09T10:00:00Z","data":"How is it going?"}',
  ]);
});
