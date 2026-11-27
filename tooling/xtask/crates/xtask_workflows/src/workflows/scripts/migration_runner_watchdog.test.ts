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

const WAIT = 20;
const DRAIN = 30;

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

const website = (status: string): Job => ({
  id: 3,
  name: 'Deploy Website / Build and Deploy Website (prod)',
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
    const jobs = [watchdog, migration(status), website('completed')];
    assert.equal(decide(jobs, NAMES, false).kind, 'wait');
    assert.equal(decide(jobs, NAMES, true).kind, 'cancel');
  }
});

test('a job that has started or is about to is left to end before the run is cancelled', () => {
  for (const status of ['in_progress', 'queued']) {
    const decision = decide([watchdog, migration('queued'), website(status)], NAMES, true);
    assert.deepEqual(decision, { kind: 'drain', running: [website(status)] });
  }
});

test('a job awaiting approval or the same runner is not waited for', () => {
  const approval = website('waiting');
  const sameRunner = { ...website('queued'), id: 4, labels: ['db-migrator'] };
  assert.equal(decide([watchdog, migration('queued'), approval, sameRunner], NAMES, true).kind, 'cancel');
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
    errors: () => lines.filter((line) => line.startsWith('::error')),
    summaries,
    cancelled: () => cancelled,
    minute: () => minute,
  };
}

const run = (listings: (Job[] | Error)[]) => {
  const w = world(listings);
  return { ...w, code: watch(w.fake, NAMES, WAIT, DRAIN, 60_000) };
};

test('a migration a runner takes passes without cancelling', async () => {
  const r = run([[watchdog, migration('queued')], [watchdog, migration('in_progress', 'db-migrator-runner')]]);
  assert.equal(await r.code, 0);
  assert.equal(r.cancelled(), 0);
  assert.match(r.lines.at(-1) ?? '', /in_progress on db-migrator-runner/);
});

test('a migration no runner takes is reported once and cancelled when the time is up', async () => {
  const r = run([[watchdog, migration('queued')]]);
  assert.equal(await r.code, 1);
  assert.equal(r.cancelled(), 1);
  assert.equal(r.minute(), WAIT);
  const errors = r.errors();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Migration runner unavailable.*No db-migrator runner picked up "Run Database Migrations" within 20 minutes/);
  assert.match(errors[0], /The run was cancelled/);
  assert.ok(errors[0].includes(RUNBOOK));
  assert.equal(r.summaries.length, 1);
});

test('the run is cancelled only after the other jobs end, and reported once', async () => {
  const waiting = [watchdog, migration('queued')];
  const r = run([
    ...Array.from({ length: WAIT + 1 }, () => [...waiting, website('in_progress')]),
    [...waiting, website('completed')],
  ]);
  assert.equal(await r.code, 1);
  assert.equal(r.minute(), WAIT + 1);
  assert.equal(r.cancelled(), 1);
  assert.equal(r.errors().length, 1);
  assert.equal(r.summaries.length, 1);
});

test('a migration that starts while other jobs drain passes and reports nothing', async () => {
  const r = run([
    ...Array.from({ length: WAIT + 1 }, () => [watchdog, migration('queued'), website('in_progress')]),
    [watchdog, migration('in_progress', 'db-migrator-runner-2'), website('in_progress')],
  ]);
  assert.equal(await r.code, 0);
  assert.equal(r.cancelled(), 0);
  assert.deepEqual(r.errors(), []);
  assert.deepEqual(r.summaries, []);
});

test('jobs still running when the drain time is up fail the watchdog without cancelling', async () => {
  const r = run([[watchdog, migration('queued'), website('in_progress')]]);
  assert.equal(await r.code, 1);
  assert.equal(r.cancelled(), 0);
  assert.equal(r.minute(), WAIT + DRAIN);
  const errors = r.errors();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Migration runner unavailable.*The run was not cancelled: Deploy Website/);
  assert.equal(r.summaries.length, 1);
});

test('a missing migration job fails without cancelling the run', async () => {
  const r = run([[watchdog, website('completed')]]);
  assert.equal(await r.code, 1);
  assert.equal(r.cancelled(), 0);
  assert.match(r.lines.at(-1) ?? '', /::error title=Migration job not found::/);
});

test('a failed read is retried, and repeated failures pass instead of failing the deploy', async () => {
  const flaky = run([new Error('HTTP 502'), [watchdog, migration('in_progress')]]);
  assert.equal(await flaky.code, 0);
  assert.equal(flaky.cancelled(), 0);

  const down = run([new Error('HTTP 502')]);
  assert.equal(await down.code, 0);
  assert.equal(down.cancelled(), 0);
  assert.equal(down.minute(), READ_FAILURES - 1);
  assert.match(down.lines.at(-1) ?? '', /::warning title=Migration runner not watched::/);
});
