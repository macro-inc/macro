import { expect, test } from 'bun:test';
import {
  type Fired,
  memoryStore,
  scheduler,
} from '@macro-inc/muppet/utilities/schedules';
import { fixedClock } from '../../../context/test/fakes.ts';
import {
  actionOf,
  ensureSchedules,
  standing,
  tick,
  watched,
} from '../schedules.ts';

const schedules = () =>
  scheduler({
    store: memoryStore(),
    clock: fixedClock('2026-11-09T15:00:00Z'),
    tz: 'America/New_York',
  });

test('the standing schedules are added when missing, and the tick is every half hour with catch-up', async () => {
  const clock = schedules();
  await ensureSchedules(clock);
  const [status] = await clock.list();
  expect(status?.name).toBe(tick);
  expect(status?.when).toBe('every hour at minute 1 and 31');
  expect(status?.next).toBe('2026-11-09T15:01:00Z');
  expect(standing[tick]).toMatchObject({ catchUp: true });
});

test('a schedule the agent changed, or paused, is left exactly as it is', async () => {
  const clock = schedules();
  await clock.set(tick, {
    every: '2h',
    why: 'the agent slowed its own heartbeat',
  });
  await clock.pause(tick);
  await ensureSchedules(clock);
  const [status] = await clock.list();
  expect(status?.schedule).toEqual({
    every: '2h',
    why: 'the agent slowed its own heartbeat',
  });
  expect(status?.paused).toBe(true);
});

const fired = (data: Readonly<Record<string, string>>): Fired => ({
  name: 'x',
  due: 'd',
  data: { ...data },
});

test('a schedule acts by itself only when its data says how', () => {
  expect(actionOf({ name: 'x', due: 'd' }, true)).toEqual({ kind: 'none' });
  expect(actionOf(fired({ note: 'for a handler' }), true)).toEqual({
    kind: 'none',
  });
  expect(actionOf(fired({ dmOwner: 'the twilio thing' }), true)).toEqual({
    kind: 'dm',
    text: 'the twilio thing',
    thenRemove: false,
  });
  expect(actionOf(fired({ wake: 'check the deploy' }), true)).toEqual({
    kind: 'wake',
    text: 'check the deploy',
    thenRemove: false,
  });
});

test('a watch does nothing until its file exists, then acts once and ends itself', () => {
  const watch = fired({ dmOwner: 'here', ifFile: '/tmp/DELIVERED' });
  expect(watched(watch)).toBe('/tmp/DELIVERED');
  expect(watched(fired({ dmOwner: 'here' }))).toBeUndefined();
  expect(actionOf(watch, false)).toEqual({ kind: 'none' });
  expect(actionOf(watch, true)).toEqual({
    kind: 'dm',
    text: 'here',
    thenRemove: true,
  });
});
