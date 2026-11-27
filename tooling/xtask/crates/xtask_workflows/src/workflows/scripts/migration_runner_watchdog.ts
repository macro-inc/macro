// Ends a deploy whose database migration no `db-migrator` runner picks up.
// `deploy_all_services.yml` runs it beside "Run Database Migrations", with the
// same needs and condition, so both become ready at once.
//
// A self-hosted job with no runner to take it waits in the queue for a day,
// and the deploy waits with it: on 2026-11-25 the runner hung and every dev
// deploy since queued behind it. The script reads the run's jobs each minute.
// Once the migration job has started (or ended), it exits 0. When the job is
// still queued after WAIT_MINUTES, it cancels the run and fails with an error
// annotation and a job summary saying the runner is unavailable, so the deploy
// ends in minutes rather than when the hourly canceller of stuck deploys
// reaches it, and the run's failed job says why.
//
// Another job of the run that has started or is about to (a prod release's
// website deploy, a build) is left to end first: the script waits up to
// DRAIN_MINUTES more for those, and then cancels the run with them, since a
// job of these runs that takes that long is stuck too. No service deploys
// before the migration has run, so a cancelled run has deployed no service.
// Right before cancelling, it reads the migration job again, alone, and lets
// the run go on if a runner took it meanwhile. If the migration job is missing
// from the run, its name or label no longer match the workflow's: the script
// fails without cancelling anything.

import { appendFileSync } from 'node:fs';

/** A job of the run, as the jobs API lists it. */
export type Job = {
  id: number;
  name: string;
  status: string;
  labels: string[];
  runner_name?: string | null;
};

/** How the script finds the migration job and itself among the run's jobs. */
export type Names = {
  /** The migration job's name; a called workflow's jobs carry the caller's prefix. */
  migration: string;
  /** The runner label the migration job runs on. */
  label: string;
  /** This job's name. */
  watchdog: string;
};

export type Decision =
  | { kind: 'started'; job: Job }
  | { kind: 'wait' }
  | { kind: 'drain'; migration: Job; running: Job[] }
  | { kind: 'cancel'; migration: Job }
  | { kind: 'missing' };

/** Where the error sends a reader. */
export const RUNBOOK = 'docs/runbooks/db-migrator-runner.md';

const named = (job: Job, name: string) => job.name === name || job.name.endsWith(` / ${name}`);

/** A job a runner has taken; a queued, waiting or pending one has none yet. */
const started = (job: Job) => job.status === 'in_progress' || job.status === 'completed';

/**
 * Another job of the run that a runner has taken or is about to take, and that
 * cancelling would cut short. A job on the migration's label waits for the
 * same missing runner, and a job waiting for an approval starts only when
 * someone approves it, so neither is waited for.
 */
const active = (job: Job, names: Names) =>
  (job.status === 'in_progress' || job.status === 'queued') &&
  !job.labels.includes(names.label) &&
  !named(job, names.watchdog);

/**
 * How many reads of the jobs in a row may fail before the script gives up and
 * passes: a watchdog that fails a deploy because GitHub's API did is worse
 * than none, and the hourly canceller still ends a stuck deploy. A cancel that
 * fails is retried as many times before the script reports it.
 */
export const READ_FAILURES = 5;

/** What to do about the run's jobs as they are now, given whether time is up. */
export function decide(jobs: Job[], names: Names, timeIsUp: boolean): Decision {
  const migration = jobs.find((job) => named(job, names.migration) && job.labels.includes(names.label));
  if (migration && started(migration)) {
    return { kind: 'started', job: migration };
  }
  if (!timeIsUp) {
    return { kind: 'wait' };
  }
  if (!migration) {
    return { kind: 'missing' };
  }
  const running = jobs.filter((job) => active(job, names));
  return running.length > 0 ? { kind: 'drain', migration, running } : { kind: 'cancel', migration };
}

export function unavailable(names: Names, minutes: number): string {
  return (
    `No ${names.label} runner picked up "${names.migration}" within ${minutes} minutes: ` +
    `the runner is offline, hung, or busy. See ${RUNBOOK}.`
  );
}

/** What the loop reads and does; the workflow passes GitHub and the clock. */
export type World = {
  jobs: () => Promise<Job[]>;
  job: (id: number) => Promise<Job>;
  cancel: () => Promise<void>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  summary: (markdown: string) => void;
};

function startedOn(world: World, names: Names, job: Job): number {
  world.log(`"${names.migration}" is ${job.status} on ${job.runner_name ?? 'a runner'}.`);
  return 0;
}

/** Reports the runner as unavailable, with what was done about the run. */
function report(world: World, names: Names, minutes: number, outcome: string) {
  const message = `${unavailable(names, minutes)} ${outcome}`;
  world.log(`::error title=Migration runner unavailable::${message}`);
  world.summary(`### Migration runner unavailable\n\n${message}\n`);
}

/**
 * Waits for the migration job to start. Resolves to the exit code: 0 once it
 * has started (or the jobs could not be read), 1 when the runner was reported
 * unavailable or the job could not be found.
 */
export async function watch(
  world: World,
  names: Names,
  minutes: number,
  drainMinutes: number,
  pollMs: number,
): Promise<number> {
  const deadline = world.now() + minutes * 60_000;
  const drainDeadline = deadline + drainMinutes * 60_000;
  let failures = 0;
  let cancelFailures = 0;
  let draining = '';
  for (;;) {
    let jobs: Job[];
    try {
      jobs = await world.jobs();
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= READ_FAILURES) {
        world.log(`::warning title=Migration runner not watched::Could not read this run's jobs: ${error}`);
        return 0;
      }
      world.log(`Could not read this run's jobs (${failures} of ${READ_FAILURES}): ${error}`);
      await world.sleep(pollMs);
      continue;
    }
    const decision = decide(jobs, names, world.now() >= deadline);
    /** The migration job when the run is to be cancelled, and what to report then. */
    let ending: { migration: Job; outcome: string } | undefined;
    switch (decision.kind) {
      case 'started':
        return startedOn(world, names, decision.job);
      case 'missing':
        world.log(`::error title=Migration job not found::This run has no "${names.migration}" job on ${names.label}.`);
        return 1;
      case 'wait':
        break;
      case 'cancel':
        ending = {
          migration: decision.migration,
          outcome: 'The run was cancelled before the migration and the service deploys.',
        };
        break;
      case 'drain': {
        const running = decision.running.map((job) => job.name).join(', ');
        if (world.now() >= drainDeadline) {
          ending = {
            migration: decision.migration,
            outcome: `The run was cancelled, cutting short ${running}, still running ${drainMinutes} minutes later.`,
          };
        } else if (running !== draining) {
          world.log(`"${names.migration}" is still queued. Cancelling the run once these end: ${running}`);
          draining = running;
        }
        break;
      }
    }
    if (ending) {
      try {
        // A listing of several pages can be stale by its last one, and a
        // runner may have taken the migration since.
        const migration = await world.job(ending.migration.id);
        if (started(migration)) {
          return startedOn(world, names, migration);
        }
        await world.cancel();
      } catch (error) {
        cancelFailures += 1;
        if (cancelFailures >= READ_FAILURES) {
          report(world, names, minutes, `The run could not be cancelled: ${error}`);
          return 1;
        }
        world.log(`Could not cancel the run (${cancelFailures} of ${READ_FAILURES}): ${error}`);
        await world.sleep(pollMs);
        continue;
      }
      report(world, names, minutes, ending.outcome);
      return 1;
    }
    await world.sleep(pollMs);
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function github(method: 'GET' | 'POST', path: string): Promise<any> {
  const response = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env('GH_TOKEN')}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${body}`);
  }
  return body ? JSON.parse(body) : null;
}

export async function main() {
  const repo = `/repos/${env('GITHUB_REPOSITORY')}`;
  const run = `${repo}/actions/runs/${env('GITHUB_RUN_ID')}`;
  const attempt = env('GITHUB_RUN_ATTEMPT');
  const names: Names = {
    migration: env('MIGRATION_JOB'),
    label: env('MIGRATION_RUNNER_LABEL'),
    watchdog: env('WATCHDOG_JOB'),
  };
  const world: World = {
    // An attempt lists every job of the run, including those a re-run of
    // failed jobs carried over from an earlier attempt.
    jobs: async () => {
      const jobs: Job[] = [];
      for (let page = 1; ; page++) {
        const listing = await github('GET', `${run}/attempts/${attempt}/jobs?per_page=50&page=${page}`);
        jobs.push(...listing.jobs);
        if (listing.jobs.length === 0 || jobs.length >= listing.total_count) {
          return jobs;
        }
      }
    },
    job: (id) => github('GET', `${repo}/actions/jobs/${id}`),
    cancel: async () => {
      await github('POST', `${run}/cancel`);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
    summary: (markdown) => appendFileSync(env('GITHUB_STEP_SUMMARY'), markdown),
  };
  process.exitCode = await watch(world, names, Number(env('WAIT_MINUTES')), Number(env('DRAIN_MINUTES')), 60_000);
}
