// When the migration runner watchdog lets a deploy go on, waits, or cancels it.
// Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, type Job, type Names, READ_FAILURES, RUNBOOK, watch, type World } from './migration_runner_watchdog.ts';

const NAMES: Names = {
  migration: 'Run Database Migrations',
  label: 'db-migrator',
  watchdog: 'Wait for the migration runner',
};

const PREFIX = 'Deploy Cloud Storage Services / ';

const migration = (status: string, runner: string | null = null): Job => ({
  id: 1,
  name: `${PREFIX}Run Database Migrations`,
  status,
  labels: ['db-migrator'],
  runner_name: runner,
});

const watchdog: Job = {
  id: 2,
  name: `${PREFIX}Wait for the migration runner`,
  status: 'in_progress',
  labels: ['namespace-profile-linux-tiny-no-cache'],
};

const build = (status: string): Job => ({
  id: 3,
  name: 'Build Web App / Build',
  status,
  labels: ['namespace-profile-linux-mid'],
});

test('a started or finished migration lets the deploy go on', () => {
  for (const status of ['in_progress', 'completed']) {
    assert.equal(decide([watchdog, migration(status)], NAMES, true).kind, 'started');
  }
});

test('a queued migration waits until time is up, then cancels', () => {
  for (const status of ['queued', 'waiting', 'pending']) {
    const jobs = [watchdog, migration(status), build('completed')];
    assert.equal(decide(jobs, NAMES, false).kind, 'wait');
    assert.equal(decide(jobs, NAMES, true).kind, 'cancel');
  }
});

test('a job still in progress is left to end before the run is cancelled', () => {
  const decision = decide([watchdog, migration('queued'), build('in_progress')], NAMES, true);
  assert.deepEqual(decision, { kind: 'drain', running: [build('in_progress')] });
});

test('a migration job on another label is not the one watched', () => {
  const elsewhere = { ...migration('in_progress'), labels: ['namespace-profile-linux-small'] };
  assert.equal(decide([watchdog, elsewhere], NAMES, false).kind, 'wait');
  assert.equal(decide([watchdog, elsewhere], NAMES, true).kind, 'missing');
});

test('a migration job called directly, without a caller prefix, is found', () => {
  const direct = { ...migration('in_progress'), name: 'Run Database Migrations' };
  assert.equal(decide([direct], NAMES, false).kind, 'started');
});

/** A run whose jobs read as `listings`, one per poll, the last repeated, with a clock a poll moves a minute. */
function world(listings: (Job[] | Error)[]) {
  let minute = 0;
  let polls = 0;
  const lines: string[] = [];
  const summaries: string[] = [];
  let cancelled = 0;
  const fake: World = {
    jobs: async () => {
      const listing = listings[Math.min(polls, listings.length - 1)];
      polls += 1;
      if (listing instanceof Error) {
        throw listing;
      }
      return listing;
    },
    cancel: async () => {
      cancelled += 1;
    },
    now: () => minute * 60_000,
    sleep: async () => {
      minute += 1;
    },
    log: (line) => lines.push(line),
    summary: (markdown) => summaries.push(markdown),
  };
  return {
    fake,
    lines,
    summaries,
    cancelled: () => cancelled,
    minute: () => minute,
  };
}

test('a migration a runner takes passes without cancelling', async () => {
  const run = world([[watchdog, migration('queued')], [watchdog, migration('in_progress', 'db-migrator-runner')]]);
  assert.equal(await watch(run.fake, NAMES, 20, 60_000), 0);
  assert.equal(run.cancelled(), 0);
  assert.match(run.lines.at(-1) ?? '', /in_progress on db-migrator-runner/);
});

test('a migration no runner takes is reported once and cancelled when the time is up', async () => {
  const run = world([[watchdog, migration('queued')]]);
  assert.equal(await watch(run.fake, NAMES, 20, 60_000), 1);
  assert.equal(run.cancelled(), 1);
  assert.equal(run.minute(), 20);
  const errors = run.lines.filter((line) => line.startsWith('::error'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Migration runner unavailable.*No db-migrator runner picked up "Run Database Migrations" within 20 minutes/);
  assert.ok(errors[0].includes(RUNBOOK));
  assert.equal(run.summaries.length, 1);
});

test('the run is cancelled only after the jobs in progress end, and reported once', async () => {
  const waiting = [watchdog, migration('queued')];
  const listings = [...Array.from({ length: 21 }, () => [...waiting, build('in_progress')]), [...waiting, build('completed')]];
  const run = world(listings);
  assert.equal(await watch(run.fake, NAMES, 20, 60_000), 1);
  assert.equal(run.minute(), 21);
  assert.equal(run.cancelled(), 1);
  assert.equal(run.lines.filter((line) => line.startsWith('::error')).length, 1);
});

test('a migration that starts while other jobs drain still passes', async () => {
  const listings = [
    ...Array.from({ length: 21 }, () => [watchdog, migration('queued'), build('in_progress')]),
    [watchdog, migration('in_progress', 'db-migrator-runner-2'), build('in_progress')],
  ];
  const run = world(listings);
  assert.equal(await watch(run.fake, NAMES, 20, 60_000), 0);
  assert.equal(run.cancelled(), 0);
});

test('a missing migration job fails without cancelling the run', async () => {
  const run = world([[watchdog, build('completed')]]);
  assert.equal(await watch(run.fake, NAMES, 20, 60_000), 1);
  assert.equal(run.cancelled(), 0);
  assert.match(run.lines.at(-1) ?? '', /::error title=Migration job not found::/);
});

test('a failed read is retried, and repeated failures pass instead of failing the deploy', async () => {
  const flaky = world([new Error('HTTP 502'), [watchdog, migration('in_progress')]]);
  assert.equal(await watch(flaky.fake, NAMES, 20, 60_000), 0);
  assert.equal(flaky.cancelled(), 0);

  const down = world([new Error('HTTP 502')]);
  assert.equal(await watch(down.fake, NAMES, 20, 60_000), 0);
  assert.equal(down.cancelled(), 0);
  assert.equal(down.minute(), READ_FAILURES - 1);
  assert.match(down.lines.at(-1) ?? '', /::warning title=Migration runner not watched::/);
});
