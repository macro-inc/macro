// When the Dev deploy alert posts to Macro Alerts, and what it says. Run by
// xtask_workflows' tests. The runs are the real ones from Dev's outage of
// 2026-11-25, when the migrations waited for the `db-migrator` runner.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  assess,
  type Context,
  decide,
  duration,
  endedProblem,
  failureMessage,
  type Health,
  type Job,
  jobsLine,
  lastDeployed,
  latestAttempts,
  longestWait,
  LOOK_BACK,
  main,
  type Names,
  readShown,
  recoveryMessage,
  records,
  type Run,
  RUNNER_WAIT_MINUTES,
  type Shown,
  type Undeployed,
  UNDEPLOYED_MINUTES,
  WHAT_TO_DO,
} from './dev_deploy_alert.ts';

const REPO = 'https://github.com/macro-inc/macro';
const MINUTE = 60 * 1000;

const NAMES: Names = {
  job: 'Tell Macro Alerts',
  failing: 'Macro Alerts shows Dev failing',
  deploying: 'Macro Alerts shows Dev deploying',
};

const at = (iso: string) => Date.parse(iso);
const plus = (iso: string, minutes: number) => new Date(at(iso) + minutes * MINUTE).toISOString();

const context = (now: string): Context => ({
  repoUrl: REPO,
  workflow: 'deploy_on_push.yml',
  cancelStuckMinutes: 90,
  now: at(now),
});

const deployRun = (
  id: number,
  run_number: number,
  sha: string,
  title: string,
  created_at: string,
  rest: Partial<Run> = {},
): Run => ({
  id,
  run_number,
  status: 'completed',
  conclusion: 'success',
  created_at,
  updated_at: created_at,
  head_sha: sha,
  html_url: `${REPO}/actions/runs/${id}`,
  head_commit: { message: `${title}\n\nbody` },
  ...rest,
});

/** Run 45706021487: the last deploy before the outage. */
const DEPLOYED = deployRun(
  45706021487,
  4817,
  '00ba60e25cc3e2e64b0baf7e448ffcbf9ccc4aff',
  "fix(email): keep Mail's empty search open while Shift+Tab reaches its tips button (#12168)",
  '2026-11-25T21:37:18Z',
  { updated_at: '2026-11-25T21:51:18Z' },
);

const STUCK_SHA = '9a242fb64f78c7d6c9622d829a47a3b1da566c15';
const STUCK_TITLE = 'fix(search): read a tag named by an emoji or holding quotes as typed (#12229)';

/** Run 45708325975, the push after it, while its migrations wait for a runner. */
const STUCK = deployRun(45708325975, 4818, STUCK_SHA, STUCK_TITLE, '2026-11-25T21:52:47Z', {
  status: 'in_progress',
  conclusion: null,
  updated_at: '2026-11-25T22:15:58Z',
});

/** The same run once `Cancel Stuck Cloud Storage Deploys` cancelled it. */
const KILLED: Run = { ...STUCK, status: 'completed', conclusion: 'cancelled', updated_at: '2026-11-26T00:02:02Z' };

/** Runs 4819-4830: pushes replaced while they waited behind run 4818. */
const REPLACED = Array.from({ length: 12 }, (_, index) =>
  deployRun(45708788238 + index, 4819 + index, `${index}`.repeat(40), `fix: push ${index} (#1220${index})`, plus('2026-11-25T21:55:56Z', index * 8), {
    conclusion: 'cancelled',
    updated_at: plus('2026-11-25T21:55:56Z', index * 8 + 3),
  }),
);

const job = (id: number, name: string, rest: Partial<Job> = {}): Job => ({
  id,
  name,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-25T21:53:00Z',
  started_at: '2026-11-25T21:53:10Z',
  completed_at: '2026-11-25T21:55:00Z',
  runner_name: `nsc-runner-${id}`,
  labels: ['namespace-profile-linux-mid'],
  steps: [{ name: 'Set up job', conclusion: 'success' }],
  ...rest,
});

const MIGRATIONS = 'Deploy Cloud Storage Services / Run Database Migrations';

/** Run 4818's jobs while its migrations waited: the builds passed, the migrations have no runner. */
const STUCK_JOBS: Job[] = [
  job(139547000001, 'Build Web App / Build'),
  job(139547000002, 'Deploy Cloud Storage Services / Build email-service binaries'),
  job(139547571482, MIGRATIONS, {
    status: 'queued',
    conclusion: null,
    created_at: '2026-11-25T22:15:58Z',
    started_at: '2026-11-25T22:15:58Z',
    completed_at: null,
    runner_name: '',
    labels: ['db-migrator'],
    steps: [],
  }),
];

/** Run 4818's jobs once it was cancelled. */
const KILLED_JOBS: Job[] = [
  ...STUCK_JOBS.slice(0, 2),
  { ...STUCK_JOBS[2], status: 'completed', conclusion: 'cancelled', completed_at: '2026-11-26T00:01:32Z' },
  job(139594877901, 'Deploy Cloud Storage Services / Deployment Summary', {
    conclusion: 'failure',
    created_at: '2026-11-26T00:01:32Z',
    labels: ['namespace-profile-linux-tiny-no-cache'],
    steps: [{ name: 'Fail if anything failed', conclusion: 'failure' }],
  }),
  job(139594880434, 'Deploy Cloud Storage Services / Deploy ${{ matrix.service }}', {
    conclusion: 'cancelled',
    created_at: '2026-11-26T00:01:33Z',
    completed_at: '2026-11-26T00:01:32Z',
    runner_name: null,
    labels: ['namespace-profile-linux-small'],
    steps: [],
  }),
];

const undeployedSince = (run: Run, headHasRun = true): Undeployed => ({
  sha: run.head_sha,
  title: String(run.head_commit?.message).split('\n')[0],
  at: run.created_at,
  headHasRun,
});

/** A `jobsOf` over a fixed map, which counts the runs it was asked about. */
function jobsFrom(byRun: Map<number, Job[]>) {
  const asked: number[] = [];
  const jobsOf = async (run: Run) => {
    asked.push(run.run_number);
    return byRun.get(run.id) ?? [];
  };
  return { asked, jobsOf };
}

async function health(runs: Run[], byRun: Map<number, Job[]>, now: string, undeployed: Undeployed | null = null) {
  return assess({ runs, deployed: DEPLOYED, undeployed, now: at(now), jobsOf: jobsFrom(byRun).jobsOf });
}

describe('assess', () => {
  test('Dev deploys while the newest run that ended succeeded', async () => {
    const result = await health([DEPLOYED], new Map(), '2026-11-25T21:52:00Z');
    assert.deepEqual(result, { problems: [], deployed: DEPLOYED });
  });

  test('reads past pushes replaced while they waited: they never started a job', async () => {
    const result = await health([...REPLACED, DEPLOYED], new Map(), '2026-11-25T23:30:00Z');
    assert.deepEqual(result.problems, []);
  });

  test('a run still waiting its turn reads no jobs', async () => {
    const waiting = { ...REPLACED[0], status: 'pending', conclusion: null };
    const { asked, jobsOf } = jobsFrom(new Map());
    const result = await assess({ runs: [waiting, DEPLOYED], deployed: DEPLOYED, undeployed: null, now: at('2026-11-25T22:00:00Z'), jobsOf });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(asked, []);
  });

  test('a job waiting under the limit for a runner is not yet a failure', async () => {
    const now = plus('2026-11-25T22:15:58Z', RUNNER_WAIT_MINUTES - 1);
    const result = await health([STUCK, DEPLOYED], new Map([[STUCK.id, STUCK_JOBS]]), now);
    assert.deepEqual(result.problems, []);
  });

  test('a job of a run still going that has waited the limit for a runner fails Dev', async () => {
    const now = plus('2026-11-25T22:15:58Z', RUNNER_WAIT_MINUTES);
    const result = await health([STUCK, DEPLOYED], new Map([[STUCK.id, STUCK_JOBS]]), now);
    assert.deepEqual(result.problems, [
      { kind: 'waiting', run: STUCK, job: { name: MIGRATIONS, labels: ['db-migrator'], minutes: RUNNER_WAIT_MINUTES, started: false } },
    ]);
  });

  test('a job that got its runner after waiting the limit keeps its run failing until the run ends', async () => {
    const started = plus('2026-11-25T22:15:58Z', RUNNER_WAIT_MINUTES + 7);
    const running = [
      ...STUCK_JOBS.slice(0, 2),
      { ...STUCK_JOBS[2], status: 'in_progress', started_at: started, runner_name: 'db-migrator-1', steps: [{ name: 'Set up job', conclusion: 'success' }] },
    ];
    const result = await health([STUCK, DEPLOYED], new Map([[STUCK.id, running]]), plus(started, 30));
    assert.deepEqual(result.problems, [
      { kind: 'waiting', run: STUCK, job: { name: MIGRATIONS, labels: ['db-migrator'], minutes: RUNNER_WAIT_MINUTES + 7, started: true } },
    ]);
    const quick = running.map((each) => (each.name === MIGRATIONS ? { ...each, started_at: plus('2026-11-25T22:15:58Z', 2) } : each));
    assert.deepEqual((await health([STUCK, DEPLOYED], new Map([[STUCK.id, quick]]), plus(started, 30))).problems, []);
  });

  test('a run cancelled after its jobs started fails Dev, however it was cancelled', async () => {
    const result = await health([...REPLACED, KILLED, DEPLOYED], new Map([[KILLED.id, KILLED_JOBS]]), '2026-11-26T00:03:00Z');
    assert.equal(result.problems.length, 1);
    assert.deepEqual(result.problems[0], {
      kind: 'cancelled',
      run: KILLED,
      waiting: [{ name: MIGRATIONS, labels: ['db-migrator'], minutes: 105.56666666666666, started: false }],
      running: [],
    });
  });

  test('a failed run fails Dev until a newer run deploys, and the replaced runs after it do not hide it', async () => {
    const failed = { ...KILLED, conclusion: 'failure' };
    const jobs = new Map([
      [
        failed.id,
        [
          job(1, 'Deploy Cloud Storage Services / Deploy email-service', {
            conclusion: 'failure',
            steps: [
              { name: 'Set up job', conclusion: 'success' },
              { name: 'pulumi up', conclusion: 'failure' },
            ],
          }),
          job(2, 'Deploy Cloud Storage Services / Deploy kafka-cluster'),
        ],
      ],
    ]);
    const red = await health([...REPLACED, failed, DEPLOYED], jobs, '2026-11-26T00:03:00Z');
    assert.deepEqual(red.problems, [
      { kind: 'failed', run: failed, jobs: [{ name: 'Deploy Cloud Storage Services / Deploy email-service', step: 'pulumi up' }] },
    ]);

    const fixed = { ...REPLACED[11], conclusion: 'success', updated_at: '2026-11-26T01:00:00Z' };
    const green = await health([fixed, ...REPLACED.slice(0, 11), failed, DEPLOYED], jobs, '2026-11-26T01:01:00Z');
    assert.deepEqual(green, { problems: [], deployed: fixed });
  });

  test('a run that failed to start fails Dev though it has no jobs', async () => {
    const broken = { ...REPLACED[0], conclusion: 'startup_failure' };
    const result = await health([broken, DEPLOYED], new Map(), '2026-11-25T22:00:00Z');
    assert.deepEqual(result.problems, [{ kind: 'failed', run: broken, jobs: [] }]);
  });

  test('stops reading jobs after the batch that holds the newest run that ended', async () => {
    const { asked, jobsOf } = jobsFrom(new Map([[KILLED.id, KILLED_JOBS]]));
    const older = Array.from({ length: 6 }, (_, index) =>
      deployRun(index + 1, 4810 - index, 'f'.repeat(40), 'old (#1)', '2026-11-25T20:00:00Z', { conclusion: 'failure' }),
    );
    const result = await assess({
      runs: [...REPLACED.slice(0, 3), KILLED, ...older],
      deployed: { ...DEPLOYED, run_number: 4700 },
      undeployed: null,
      now: at('2026-11-26T00:03:00Z'),
      jobsOf,
    });
    assert.equal(result.problems[0]?.kind, 'cancelled');
    assert.deepEqual(asked.sort(), [4810, 4818, 4819, 4820, 4821]);
  });

  test('Dev fails once its oldest undeployed commit is past the limit, whatever holds it', async () => {
    const since = undeployedSince(REPLACED[0]);
    const before = await health([REPLACED[0], DEPLOYED], new Map(), plus(since.at, UNDEPLOYED_MINUTES - 1), since);
    assert.deepEqual(before.problems, []);
    const after = await health([REPLACED[0], DEPLOYED], new Map(), plus(since.at, UNDEPLOYED_MINUTES), since);
    assert.deepEqual(after.problems, [{ kind: 'undeployed', since, minutes: UNDEPLOYED_MINUTES, deploying: null }]);
  });

  test('a success the list holds newer than the last one queried is what Dev deployed', async () => {
    const newer = { ...REPLACED[11], conclusion: 'success' };
    assert.equal(lastDeployed(DEPLOYED, [newer, DEPLOYED]), newer);
    assert.equal(lastDeployed(null, [REPLACED[0]]), null);
    const result = await health([newer, DEPLOYED], new Map(), '2026-11-26T00:00:00Z');
    assert.equal(result.deployed, newer);
  });
});

describe('endedProblem and longestWait', () => {
  test('names the job each failed at, from its latest attempt', () => {
    const run = { ...KILLED, conclusion: 'failure' };
    const problem = endedProblem(run, [
      job(1, 'Deploy Web App / Deploy', { conclusion: 'failure', steps: [{ name: 'upload', conclusion: 'failure' }] }),
      job(2, 'Deploy Web App / Deploy', { conclusion: 'success', run_attempt: 2 }),
      job(3, 'Deploy Sync Service / Deploy to Cloudflare', { conclusion: 'timed_out', steps: [{ name: 'wrangler deploy', conclusion: 'cancelled' }] }),
    ]);
    assert.deepEqual(problem, {
      kind: 'failed',
      run,
      jobs: [{ name: 'Deploy Sync Service / Deploy to Cloudflare', step: 'wrangler deploy' }],
    });
  });

  test('names a job cancelled while it ran, with its step', () => {
    const problem = endedProblem({ ...KILLED, updated_at: '2026-11-25T22:17:08Z' }, [
      job(1, 'Deploy Cloud Storage Services / Deploy email-service', {
        conclusion: 'cancelled',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'pulumi up', conclusion: 'cancelled' },
        ],
      }),
    ]);
    assert.equal(problem.kind, 'cancelled');
    assert.deepEqual(problem.kind === 'cancelled' && problem.running, [
      { name: 'Deploy Cloud Storage Services / Deploy email-service', step: 'pulumi up' },
    ]);
  });

  test('a job that got its runner waited from its creation to its start', () => {
    const running = job(1, MIGRATIONS, { status: 'in_progress', conclusion: null, created_at: '2026-11-25T20:00:00Z', started_at: '2026-11-25T20:00:30Z' });
    const waiting = job(2, 'Build Web App / Build', { status: 'queued', conclusion: null, created_at: '2026-11-25T22:59:30Z', runner_name: '' });
    assert.deepEqual(longestWait([running, waiting], at('2026-11-25T23:00:00Z')), {
      name: 'Build Web App / Build',
      labels: ['namespace-profile-linux-mid'],
      minutes: 0.5,
      started: false,
    });
    assert.equal(longestWait([job(3, 'skipped', { conclusion: 'skipped', runner_name: null })], at('2026-11-25T23:00:00Z')), null);
  });

  test('latest attempts keep one job per name', () => {
    const jobs = latestAttempts([job(1, 'a'), job(2, 'b'), job(3, 'a', { run_attempt: 2 })]);
    assert.deepEqual(
      jobs.map((each) => each.id),
      [2, 3],
    );
  });
});

const alertRun = (run_number: number): Run =>
  deployRun(46000000000 + run_number, run_number, 'c'.repeat(40), 'ci (#1)', plus('2026-11-25T22:00:00Z', run_number));

/** An alert job whose run started at `started`, and what it recorded. */
const alertJob = (shows: 'failing' | 'deploying' | null, started: string, posted = false, rest: Partial<Job> = {}): Job => {
  const completed = plus(started, 1);
  return job(1, NAMES.job, {
    created_at: started,
    started_at: started,
    completed_at: completed,
    steps: [
      { name: 'decide what to post', conclusion: 'success', completed_at: completed },
      { name: 'post to Macro Alerts', conclusion: posted ? 'success' : 'skipped', completed_at: completed },
      { name: NAMES.failing, conclusion: shows === 'failing' ? 'success' : 'skipped', completed_at: completed },
      { name: NAMES.deploying, conclusion: shows === 'deploying' ? 'success' : 'skipped', completed_at: completed },
    ],
    ...rest,
  });
};

describe('readShown', () => {
  test('the newest record is what the channel shows', async () => {
    const jobs = new Map([
      [alertRun(3).id, [alertJob('failing', '2026-11-25T23:22:40Z', true)]],
      [alertRun(2).id, [alertJob('deploying', '2026-11-25T23:07:40Z')]],
    ]);
    const { jobsOf } = jobsFrom(jobs);
    assert.deepEqual(await readShown([alertRun(2), alertRun(3)], NAMES, jobsOf), {
      failing: true,
      at: '2026-11-25T23:22:40Z',
    });
  });

  test('an older run started again by hand holds the newest record', async () => {
    const again = { ...alertRun(1), run_started_at: '2026-11-25T23:30:00Z' };
    const jobs = new Map([
      [again.id, [alertJob('deploying', '2026-11-25T22:01:00Z'), alertJob('failing', '2026-11-25T23:30:00Z', true, { id: 2, run_attempt: 2 })]],
      [alertRun(9).id, [alertJob('deploying', '2026-11-25T23:22:00Z')]],
    ]);
    const runs = [alertRun(9), ...Array.from({ length: 7 }, (_, index) => alertRun(index + 2)), again];
    assert.deepEqual(await readShown(runs, NAMES, jobsFrom(jobs).jobsOf), { failing: true, at: '2026-11-25T23:30:00Z' });
  });

  test('reads past runs that hold no record', async () => {
    const jobs = new Map([
      [alertRun(9).id, [alertJob(null, '2026-11-26T00:02:40Z')]],
      [alertRun(1).id, [alertJob('failing', '2026-11-25T23:22:40Z', true)]],
    ]);
    const runs = Array.from({ length: 9 }, (_, index) => alertRun(index + 1));
    assert.deepEqual(await readShown(runs, NAMES, jobsFrom(jobs).jobsOf), { failing: true, at: '2026-11-25T23:22:40Z' });
  });

  test('with no record, the channel shows Dev deploying', async () => {
    const runs = Array.from({ length: LOOK_BACK + 5 }, (_, index) => alertRun(index + 1));
    const { asked, jobsOf } = jobsFrom(new Map());
    assert.deepEqual(await readShown(runs, NAMES, jobsOf), { failing: false, at: null });
    assert.equal(asked.length, LOOK_BACK);
  });

  test('records count only for the alert job', () => {
    assert.deepEqual(records([{ ...alertJob('failing', '2026-11-25T23:22:40Z'), name: 'other' }], NAMES), []);
  });
});

describe('decide', () => {
  const failing: Health = { problems: [{ kind: 'failed', run: KILLED, jobs: [] }], deployed: DEPLOYED };
  const deploying: Health = { problems: [], deployed: DEPLOYED };

  test('posts the failure when the channel shows Dev deploying', () => {
    assert.equal(decide(failing, { failing: false, at: null }).post, 'failure');
  });

  test('posts nothing more while the channel shows Dev failing', () => {
    const decision = decide(failing, { failing: true, at: '2026-11-25T23:22:40Z' });
    assert.equal(decision.post, null);
    assert.equal(decision.failing, true);
    assert.match(decision.why, /already shows it failing \(since 2026-11-25T23:22:40Z\)/);
  });

  test('posts the recovery when Dev deployed after the channel was told it is failing', () => {
    const again: Health = { problems: [], deployed: { ...REPLACED[11], updated_at: '2026-11-26T00:40:00Z' } };
    assert.deepEqual(decide(again, { failing: true, at: '2026-11-25T23:22:40Z' }), {
      post: 'recovery',
      failing: false,
      why: 'Dev deploys again',
    });
  });

  test('a failed run re-run fails nothing while it goes, but is no recovery until it deploys', async () => {
    const failed = { ...REPLACED[11], conclusion: 'failure', updated_at: '2026-11-26T00:40:00Z' };
    const told: Shown = { failing: true, at: '2026-11-26T00:41:00Z' };
    const rerun = { ...failed, status: 'in_progress', conclusion: null, updated_at: '2026-11-26T01:00:00Z' };
    const going = await health([rerun, DEPLOYED], new Map([[rerun.id, [job(1, 'Build Web App / Build', { status: 'in_progress', conclusion: null })]]]), '2026-11-26T01:07:00Z');
    assert.deepEqual(going.problems, []);
    const decision = decide(going, told);
    assert.equal(decision.post, null);
    assert.equal(decision.failing, true);
    assert.match(decision.why, /has deployed nothing since the channel was told it is failing \(since 2026-11-26T00:41:00Z\)/);

    const deployedAgain = { ...rerun, status: 'completed', conclusion: 'success', updated_at: '2026-11-26T01:30:00Z' };
    const done = await health([deployedAgain, DEPLOYED], new Map(), '2026-11-26T01:31:00Z');
    assert.equal(decide(done, { failing: true, at: '2026-11-26T01:07:00Z' }).post, 'recovery');
  });

  test('posts nothing while Dev deploys and the channel shows it', () => {
    assert.equal(decide(deploying, { failing: false, at: null }).post, null);
  });
});

/**
 * Run 45708325975 hour by hour, as `Dev Deploy Alert` would have seen it,
 * carrying what the channel shows from each run to the next.
 */
describe('the outage of 2026-11-25', () => {
  test('posts once when the migrations have waited the limit, nothing at the cancel, and once when Dev deploys again', async () => {
    let shown = { failing: false, at: null as string | null };
    const posts: string[] = [];
    const tick = async (now: string, runs: Run[], jobs: Map<number, Job[]>, undeployed: Undeployed | null) => {
      const result = await health(runs, jobs, now, undeployed);
      const decision = decide(result, shown);
      if (decision.post === 'failure') {
        posts.push(`${now} ${failureMessage(result, context(now)).split('\n')[0]}`);
      } else if (decision.post === 'recovery') {
        posts.push(`${now} ${recoveryMessage(result.deployed ?? DEPLOYED, DEPLOYED, context(now)).split('\n')[0]}`);
      }
      shown = { failing: decision.failing, at: now };
    };
    const since = undeployedSince(STUCK);
    const stuck = new Map([[STUCK.id, STUCK_JOBS]]);
    // Every quarter of an hour, while the migrations wait.
    for (const now of ['2026-11-25T22:22:00Z', '2026-11-25T22:52:00Z', '2026-11-25T23:07:00Z', '2026-11-25T23:22:00Z', '2026-11-25T23:52:00Z']) {
      await tick(now, [...REPLACED, STUCK, DEPLOYED], stuck, since);
    }
    // The cancel ends run 4818; run 4831 starts and its migrations wait too.
    const next = deployRun(45722336240, 4831, 'a1acd5ba85c0c973d030af95b9d55ae6bb3e39ae', 'fix(search): keep every picked tag group (#12246)', '2026-11-25T23:33:54Z', {
      status: 'in_progress',
      conclusion: null,
    });
    await tick('2026-11-26T00:03:00Z', [next, ...REPLACED, KILLED, DEPLOYED], new Map([[KILLED.id, KILLED_JOBS]]), since);
    // A fixed runner deploys run 4831.
    const deployedAgain = { ...next, status: 'completed', conclusion: 'success', updated_at: '2026-11-26T00:40:00Z' };
    await tick('2026-11-26T00:41:00Z', [deployedAgain, ...REPLACED, KILLED, DEPLOYED], new Map(), null);
    await tick('2026-11-26T00:52:00Z', [deployedAgain, ...REPLACED, KILLED, DEPLOYED], new Map(), null);

    assert.deepEqual(posts, [
      `2026-11-25T23:22:00Z 🚨 · **Dev deploy is stuck waiting for a runner** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
      `2026-11-26T00:41:00Z ✅ Resolved · **Dev deploys again** · push of \`a1acd5b\` fix(search): keep every picked tag group ([#12246](${REPO}/pull/12246))`,
    ]);
  });
});

/**
 * Run 4103 of 2026-11-18, whose `Build Web App / Build` waited 1 h 7 min for a
 * runner, ran, and was cancelled at 90 min: one failure, no recovery when the
 * job got its runner, none at the cancel, and one when a run deploys.
 */
describe('a job that waited over the limit, then ran', () => {
  test('posts once when it has waited the limit, and once when a run deploys', async () => {
    const created = '2026-11-18T20:25:33Z';
    const run = deployRun(44109573830, 4103, '78cc5a0'.padEnd(40, '0'), "feat(email-focus): publish and alert on the rollout's go/stop numbers (#11017)", '2026-11-18T20:25:30Z', {
      status: 'in_progress',
      conclusion: null,
    });
    const build = job(1, 'Build Web App / Build', {
      status: 'queued',
      conclusion: null,
      created_at: created,
      started_at: created,
      completed_at: null,
      runner_name: '',
      labels: ['namespace-profile-linux-mid'],
      steps: [],
    });
    const ran = { ...build, status: 'in_progress', started_at: '2026-11-18T21:32:12Z', runner_name: 'nsc-runner-2', steps: [{ name: 'Set up job', conclusion: 'success' }] };
    const cancelled = { ...ran, status: 'completed', conclusion: 'cancelled', completed_at: '2026-11-18T22:01:00Z', steps: [{ name: 'Build', conclusion: 'cancelled' }] };
    const ended = { ...run, status: 'completed', conclusion: 'cancelled', updated_at: '2026-11-18T22:01:58Z' };
    const next = deployRun(44113581910, 4124, '6e9ec8d'.padEnd(40, '0'), 'fix(email): preserve a newer reply when undoing a send (#11324)', '2026-11-18T22:01:00Z', {
      updated_at: '2026-11-18T22:45:52Z',
    });

    const before = deployRun(44104905651, 4097, '68ca073'.padEnd(40, '0'), 'feat(email-focus): count Focus tab visits, empty tabs and thread opens (#11160)', '2026-11-18T19:50:00Z', {
      updated_at: '2026-11-18T20:25:27Z',
    });

    let shown: Shown = { failing: false, at: null };
    const posts: string[] = [];
    const tick = async (now: string, runs: Run[], jobs: Job[]) => {
      const { jobsOf } = jobsFrom(new Map([[run.id, jobs]]));
      const result = await assess({ runs, deployed: before, undeployed: null, now: at(now), jobsOf });
      const decision = decide(result, shown);
      if (decision.post) {
        posts.push(`${now} ${(decision.post === 'failure' ? failureMessage(result, context(now)) : recoveryMessage(next, before, context(now))).split('\n')[0]}`);
      }
      shown = { failing: decision.failing, at: now };
    };
    await tick('2026-11-18T21:22:00Z', [run, before], [build]);
    await tick('2026-11-18T21:26:00Z', [run, before], [build]);
    await tick('2026-11-18T21:33:00Z', [run, before], [ran]);
    await tick('2026-11-18T21:52:00Z', [run, before], [ran]);
    await tick('2026-11-18T22:02:58Z', [ended, before], [cancelled]);
    await tick('2026-11-18T22:46:52Z', [next, ended, before], [cancelled]);

    assert.deepEqual(posts, [
      `2026-11-18T21:26:00Z 🚨 · **Dev deploy is stuck waiting for a runner** · push of \`78cc5a0\` feat(email-focus): publish and alert on the rollout's go/stop numbers ([#11017](${REPO}/pull/11017))`,
      `2026-11-18T22:46:52Z ✅ Resolved · **Dev deploys again** · push of \`6e9ec8d\` fix(email): preserve a newer reply when undoing a send ([#11324](${REPO}/pull/11324))`,
    ]);
  });

  test('says the job has run since, when it got its runner before the alert ran', async () => {
    const started = plus('2026-11-25T22:15:58Z', 62);
    const ran = { ...STUCK_JOBS[2], status: 'in_progress', started_at: started, runner_name: 'db-migrator-1', steps: [{ name: 'Set up job', conclusion: 'success' }] };
    const now = plus(started, 5);
    const result = await health([STUCK, DEPLOYED], new Map([[STUCK.id, [ran]]]), now);
    assert.deepEqual(failureMessage(result, context(now)).split('\n').slice(0, 2), [
      `🚨 · **Dev deploy was held up waiting for a runner** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
      '`Deploy Cloud Storage Services / Run Database Migrations` waited 1 h 2 min for a runner labelled `db-migrator`, and has run since.',
    ]);
  });
});

describe('messages', () => {
  const docs = `[What to do](${REPO}/blob/main/${WHAT_TO_DO})`;

  test('a job waiting for a runner', async () => {
    const now = '2026-11-25T23:22:00Z';
    const result = await health([STUCK, DEPLOYED], new Map([[STUCK.id, STUCK_JOBS]]), now, undeployedSince(STUCK));
    assert.equal(
      failureMessage(result, context(now)),
      [
        `🚨 · **Dev deploy is stuck waiting for a runner** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
        '`Deploy Cloud Storage Services / Run Database Migrations` has waited 1 h 6 min for a runner labelled `db-migrator`.',
        `Dev last deployed \`00ba60e\` 1 h 30 min ago · [changes since](${REPO}/compare/${DEPLOYED.head_sha}...${STUCK_SHA})`,
        `[Run](${REPO}/actions/runs/45708325975) · ${docs}`,
      ].join('\n'),
    );
  });

  test('a deploy cancelled for running too long', async () => {
    const now = '2026-11-26T00:03:00Z';
    const result = await health([KILLED, DEPLOYED], new Map([[KILLED.id, KILLED_JOBS]]), now, undeployedSince(STUCK));
    assert.equal(
      failureMessage(result, context(now)),
      [
        `🚨 · **Dev deploy was cancelled** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
        'Cancelled 2 h 9 min after the push, past the 90 min after which `Cancel Stuck Cloud Storage Deploys` cancels a deploy.',
        'Still waiting then: `Deploy Cloud Storage Services / Run Database Migrations` waited 1 h 45 min for a runner labelled `db-migrator`.',
        `Dev last deployed \`00ba60e\` 2 h 11 min ago · [changes since](${REPO}/compare/${DEPLOYED.head_sha}...${STUCK_SHA})`,
        `[Run](${REPO}/actions/runs/45708325975) · ${docs}`,
      ].join('\n'),
    );
  });

  test('a failed deploy, and the next run stuck behind it', async () => {
    const failed = { ...KILLED, conclusion: 'failure' };
    const next = { ...STUCK, id: 2, run_number: 4831, created_at: '2026-11-26T00:00:00Z', html_url: `${REPO}/actions/runs/2` };
    const now = '2026-11-26T01:20:00Z';
    const jobs = new Map<number, Job[]>([
      [failed.id, [job(1, 'Deploy Web App / Deploy', { conclusion: 'failure', steps: [{ name: 'upload', conclusion: 'failure' }] })]],
      [next.id, [{ ...STUCK_JOBS[2], created_at: '2026-11-26T00:10:00Z' }]],
    ]);
    const result = await health([next, failed, DEPLOYED], jobs, now);
    assert.deepEqual(failureMessage(result, context(now)).split('\n').slice(0, 3), [
      `🚨 · **Dev deploy failed** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
      'Failed jobs: `Deploy Web App / Deploy` at “upload”',
      `In [run #4831](${REPO}/actions/runs/2), \`Deploy Cloud Storage Services / Run Database Migrations\` has waited 1 h 10 min for a runner labelled \`db-migrator\`.`,
    ]);
  });

  test('a push that started no run', async () => {
    const since: Undeployed = { sha: 'b'.repeat(40), title: 'feat: a change (#12300)', at: '2026-11-26T09:00:00Z', headHasRun: false };
    const now = '2026-11-26T12:30:00Z';
    const result = await health([DEPLOYED], new Map(), now, since);
    assert.equal(
      failureMessage(result, context(now)),
      [
        `🚨 · **Dev has not deployed for 3 h 30 min** · since the push of \`bbbbbbb\` feat: a change ([#12300](${REPO}/pull/12300))`,
        'No `Deploy on Push` run started for the newest push: check that the workflow is enabled.',
        'Dev last deployed `00ba60e` 14 h 38 min ago',
        `[Runs](${REPO}/actions/workflows/deploy_on_push.yml) · ${docs}`,
      ].join('\n'),
    );
  });

  test('Dev deploying again', () => {
    const again = { ...STUCK, status: 'completed', conclusion: 'success', updated_at: '2026-11-27T23:51:18Z' };
    assert.equal(
      recoveryMessage(again, DEPLOYED, context('2026-11-27T23:52:00Z')),
      [
        `✅ Resolved · **Dev deploys again** · push of \`9a242fb\` fix(search): read a tag named by an emoji or holding quotes as typed ([#12229](${REPO}/pull/12229))`,
        `Dev had last deployed \`00ba60e\` 2 d 2 h before. [Run](${REPO}/actions/runs/45708325975)`,
      ].join('\n'),
    );
  });

  test('a commit title is kept out of tags', () => {
    const run = { ...STUCK, head_commit: { message: 'fix: <b> tags `quoted`' } };
    assert.match(failureMessage({ problems: [{ kind: 'failed', run, jobs: [] }], deployed: null }, context('2026-11-26T00:00:00Z')), /push of `9a242fb` fix: ‹b› tags `quoted`/);
  });

  test('jobs that stopped at the same step go together', () => {
    assert.equal(
      jobsLine([
        { name: 'a', step: 'pulumi up' },
        { name: 'b', step: 'pulumi up' },
        { name: 'c', step: null },
      ]),
      '`a`, `b` at “pulumi up”; `c`',
    );
  });

  test('durations', () => {
    assert.deepEqual(
      [0.5, 59.9, 60, 66, 1439, 1440, 3000].map(duration),
      ['0 min', '59 min', '1 h', '1 h 6 min', '23 h 59 min', '1 d', '2 d 2 h'],
    );
  });
});

/** A stand-in for the GitHub API `main` reads: what it answers a path with, or nothing (404). */
type Api = (path: string, query: URLSearchParams) => unknown;

/** Runs `main` against `api`, and returns its outputs, its message and the paths it asked for. */
async function runMain(api: Api) {
  const dir = mkdtempSync(join(tmpdir(), 'dev-deploy-alert-'));
  const files = {
    GITHUB_OUTPUT: join(dir, 'output'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary'),
    DEV_DEPLOY_ALERT_MESSAGE: join(dir, 'message.md'),
  };
  for (const file of Object.values(files)) {
    writeFileSync(file, '');
  }
  const vars: Record<string, string> = {
    GITHUB_REPOSITORY: 'macro-inc/macro',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.test',
    GITHUB_RUN_ID: '1',
    GH_TOKEN: 'token',
    DEV_DEPLOY_WORKFLOW: 'deploy_on_push.yml',
    DEV_DEPLOY_CANCEL_STUCK_MINUTES: '90',
    DEV_DEPLOY_ALERT_JOB: NAMES.job,
    DEV_DEPLOY_ALERT_FAILING_STEP: NAMES.failing,
    DEV_DEPLOY_ALERT_DEPLOYING_STEP: NAMES.deploying,
    ...files,
  };
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const { fetch, log } = { fetch: globalThis.fetch, log: console.log };
  const asked: string[] = [];
  Object.assign(process.env, vars);
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(`${url.pathname}?${url.searchParams}`);
    const body = api(url.pathname, url.searchParams);
    return body === undefined ? new Response('Not Found', { status: 404 }) : new Response(JSON.stringify(body));
  }) as typeof globalThis.fetch;
  console.log = () => {};
  try {
    await main();
  } finally {
    globalThis.fetch = fetch;
    console.log = log;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
  return {
    outputs: readFileSync(files.GITHUB_OUTPUT, 'utf8').trim().split('\n'),
    message: readFileSync(files.DEV_DEPLOY_ALERT_MESSAGE, 'utf8'),
    asked,
  };
}

/** The API over these deploy runs, newest first, with the alert workflow's own runs. */
function api({
  deploys,
  succeeded,
  head,
  jobs = new Map<number, Job[]>(),
  alertRuns = [],
}: {
  deploys: Run[];
  /** What the query for the last successes answers. */
  succeeded: Run[];
  head: Run;
  jobs?: Map<number, Job[]>;
  alertRuns?: Run[];
}): Api {
  const repo = '/repos/macro-inc/macro';
  return (path, query) => {
    if (path === `${repo}/actions/runs/1`) {
      return { workflow_id: 9 };
    }
    if (path === `${repo}/actions/workflows/9/runs`) {
      return { workflow_runs: alertRuns };
    }
    if (path === `${repo}/actions/workflows/deploy_on_push.yml/runs`) {
      if (query.get('status') === 'success') {
        return { workflow_runs: succeeded };
      }
      const page = Number(query.get('page') ?? '1');
      const size = Number(query.get('per_page'));
      return { workflow_runs: deploys.slice((page - 1) * size, page * size) };
    }
    const run = /\/actions\/runs\/(\d+)\/jobs$/.exec(path)?.[1];
    if (run) {
      const listed = jobs.get(Number(run)) ?? [];
      return { jobs: listed, total_count: listed.length };
    }
    if (path === `${repo}/branches/main`) {
      return { commit: { sha: head.head_sha, commit: { message: head.head_commit?.message, committer: { date: head.created_at } } } };
    }
    return undefined;
  };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();

const failedJob = job(1, 'Build Web App / Build', { conclusion: 'failure', steps: [{ name: 'Build', conclusion: 'failure' }] });

describe('main', () => {
  test('posts a failure when no run ever deployed Dev', async () => {
    const failed = deployRun(9001, 1, 'f'.repeat(40), 'feat: the first deploy (#1)', ago(30), { conclusion: 'failure', updated_at: ago(5) });
    const { outputs, message } = await runMain(
      api({ deploys: [failed], succeeded: [], head: failed, jobs: new Map([[failed.id, [failedJob]]]) }),
    );
    assert.deepEqual(outputs, ['shows=failing', 'post=true']);
    assert.match(message, /^🚨 · \*\*Dev deploy failed\*\* · push of `fffffff` feat: the first deploy/);
    assert.match(message, /No run of the last ones listed deployed Dev\./);
  });

  test('lists runs back to the one Dev deployed, past a page of replaced ones', async () => {
    const deployed = deployRun(9001, 1, 'd'.repeat(40), 'feat: deployed (#1)', ago(300), { updated_at: ago(280) });
    const failed = deployRun(9002, 2, 'f'.repeat(40), 'feat: failed (#2)', ago(279), { conclusion: 'failure', updated_at: ago(250) });
    const replaced = Array.from({ length: 100 }, (_, index) =>
      deployRun(9003 + index, 3 + index, String(index).padStart(40, '0'), `feat: change ${index} (#${3 + index})`, ago(170 - index), {
        conclusion: 'cancelled',
      }),
    ).reverse();
    const { outputs, message, asked } = await runMain(
      api({ deploys: [...replaced, failed, deployed], succeeded: [deployed], head: replaced[0], jobs: new Map([[failed.id, [failedJob]]]) }),
    );
    assert.deepEqual(outputs, ['shows=failing', 'post=true']);
    assert.match(message, /^🚨 · \*\*Dev deploy failed\*\* · push of `fffffff` feat: failed/);
    assert.deepEqual(
      asked.filter((path) => path.includes('deploy_on_push.yml') && !path.includes('status=success')).map((path) => new URLSearchParams(path.split('?')[1]).get('page')),
      ['1', '2'],
    );
  });

  test('a run that succeeded between its two reads is what Dev deployed, for every check', async () => {
    const before = deployRun(9001, 1, 'b'.repeat(40), 'feat: before (#1)', ago(600), { updated_at: ago(560) });
    const deployed = deployRun(9002, 2, 'd'.repeat(40), 'feat: deployed (#2)', ago(300), { updated_at: ago(1) });
    const told = { ...alertRun(1), run_started_at: ago(10) };
    const { outputs, message } = await runMain(
      api({
        deploys: [deployed, before],
        succeeded: [before],
        head: deployed,
        jobs: new Map([[told.id, [alertJob('failing', ago(10))]]]),
        alertRuns: [told],
      }),
    );
    assert.deepEqual(outputs, ['shows=deploying', 'post=true']);
    assert.deepEqual(message.split('\n')[0], '✅ Resolved · **Dev deploys again** · push of `ddddddd` feat: deployed ([#2](https://github.com/macro-inc/macro/pull/2))');
    assert.match(message, /Dev had last deployed `bbbbbbb`/);
  });
});
