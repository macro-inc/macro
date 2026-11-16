// The area composes with the rest of the agent, and its polling is a schedule like any other.
import { expect, test } from 'bun:test';
import { behavior } from '@macro-inc/muppet/core/behavior';
import {
  memoryStore,
  scheduler,
  type scheduling,
} from '@macro-inc/muppet/utilities/schedules';
import type { Base } from '../../../context/index.ts';
import { fixedClock } from '../../../context/test/fakes.ts';
import { secretsHandlers } from '../../../events/handlers/secrets.ts';
import { pollEvery, pollSchedule } from '../config.ts';
import { secretsContext } from '../context.ts';
import { secretsCapabilities } from '../index.ts';
import { polling } from '../ports.ts';

// Never called: it only has to compile, as behavior/index.ts will compose it.
export const composed = (
  base: Base,
  scheduled: ReturnType<typeof scheduling>
) =>
  behavior()
    .decorate(base)
    .use(scheduled)
    .use(secretsContext(base, scheduled.decorations.schedules))
    .use(secretsCapabilities)
    .use(secretsHandlers(scheduled));

test('polling is one schedule, set once while anything is pending and removed after', async () => {
  const schedules = scheduler({
    store: memoryStore(),
    clock: fixedClock('2026-11-11T12:00:00Z'),
    tz: 'UTC',
  });
  const poll = polling(schedules);
  await poll.ensure();
  await poll.ensure();
  expect(
    (await schedules.list()).map(({ name, schedule }) => [
      name,
      'every' in schedule ? schedule.every : undefined,
    ])
  ).toEqual([[pollSchedule, pollEvery]]);
  await poll.stop();
  await poll.stop();
  expect(await schedules.list()).toEqual([]);
});
