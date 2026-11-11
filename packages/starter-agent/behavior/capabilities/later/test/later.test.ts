import { expect, test } from 'bun:test';
import { memoryStore, scheduler } from '@macro-inc/muppet/utilities/schedules';
import { invoke } from '../../../../test/invoke.ts';
import { later, laterModule, prefix, request } from '../index.ts';

const now = Temporal.Instant.from('2026-01-05T10:00:00Z');
const clock = { now: () => now, sleep: async () => {} };

const context = () => {
  const schedules = scheduler({ store: memoryStore(), clock, tz: 'UTC' });
  let made = 0;
  const work = later({ schedules, clock, id: () => String(++made) });
  return { schedules, work };
};

test('a task is a one-off schedule, due now, that wakes the agent with a request that stands alone', async () => {
  const { schedules, work } = context();
  const { id } = await work.start({
    task: 'Find the invoice Ada asked for.',
    label: 'find invoice',
    channelId: 'c1',
    root: 'm1',
  });
  expect(id).toBe(`${prefix}1`);
  const [status] = await schedules.list();
  expect(status?.schedule).toEqual({
    at: '2026-01-05T10:00:00Z',
    why: 'find invoice',
    data: {
      wake: request({
        task: 'Find the invoice Ada asked for.',
        label: 'find invoice',
        channelId: 'c1',
        root: 'm1',
      }),
    },
  });
  expect(
    request({ task: 'x', label: 'y', channelId: 'c1', root: 'm1' })
  ).toContain('channel c1, in the thread of message m1');
  expect(request({ task: 'x', label: 'y' })).toContain('Nobody is waiting');
});

test('what is waiting is listed by name, and nothing else on the clock is', async () => {
  const { schedules, work } = context();
  expect(await work.inFlight()).toBe('None.');
  await schedules.set('tick', { every: '30m' });
  await work.start({ task: 'x', label: 'the first' });
  expect(await work.inFlight()).toBe(`- ${prefix}1: the first`);
});

test('an empty task or label hands nothing over', async () => {
  const { schedules, work } = context();
  for (const asked of [
    { task: ' ', label: 'x' },
    { task: 'x', label: '' },
  ])
    expect((await invoke(laterModule, 'doLater', { work }, asked)).kind).toBe(
      'failed'
    );
  expect(
    (await invoke(laterModule, 'doLater', { work }, { task: 'x' })).kind
  ).toBe('invalid');
  expect(await schedules.list()).toEqual([]);
});
