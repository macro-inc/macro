// Scenarios for the CI telemetry collector and sender. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  classifyFiles,
  clockStart,
  collect,
  collectPush,
  DEV_SHELL_STEP,
  type GithubApi,
  type Job,
  jobEvents,
  MAX_EVENT_AGE_SECONDS,
  type PullRequest,
  pushEvent,
  type Run,
  sameTriggerRuns,
  type Step,
  toOtlp,
  traceIds,
} from './ci_telemetry_collect.ts';
import { authorization } from './ci_telemetry_send.ts';

const REPO = 'acme/repo';

function at(minute: number, second = 0) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `2026-01-01T10:${pad(minute)}:${pad(second)}Z`;
}

function when(minute: number, second = 0) {
  return new Date(at(minute, second));
}

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 1,
    name: 'code check',
    run_attempt: 1,
    event: 'pull_request',
    head_sha: 'abc',
    head_branch: 'someone/some-change',
    status: 'completed',
    conclusion: 'success',
    created_at: at(0, 10),
    updated_at: at(5),
    pull_requests: [{ number: 7 }],
    ...overrides,
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 11,
    name: 'test',
    conclusion: 'success',
    created_at: at(0, 40),
    started_at: at(1),
    completed_at: at(5),
    labels: ['namespace-profile-linux-large;overrides.cache-tag=x'],
    steps: [],
    ...overrides,
  };
}

function step(name: string, start: string, end: string): Step {
  return { name, started_at: start, completed_at: end, conclusion: 'success' };
}

function jobsMap(entries: Record<number, Job[]>) {
  return new Map(Object.entries(entries).map(([id, jobs]) => [Number(id), jobs]));
}

type PushOptions = {
  pushed?: Date | null;
  files?: readonly string[] | null;
  pullRequest?: PullRequest | null;
  head?: Run;
  repeat?: number;
};

function push(runs: Run[], jobs: Record<number, Job[]>, options: PushOptions = {}) {
  const event = pushEvent(
    REPO,
    options.head ?? runs[0],
    runs,
    jobsMap(jobs),
    options.pushed ?? null,
    options.pullRequest ?? null,
    options.files === undefined ? ['crates/a/src/lib.rs'] : options.files,
    options.repeat ?? 0
  );
  assert.ok(event);
  return event;
}

describe('classifyFiles', () => {
  test('types', () => {
    const cases: [string[], string][] = [
      [['apps/web/src/a.tsx'], 'web'],
      [['infra/stacks/a.ts', '.github/workflows/a.yml'], 'infra'],
      [['docs/a.md'], 'other'],
      [['crates/a/src/lib.rs', 'apps/web/b.ts'], 'mixed'],
      [['crates/a/src/lib.rs'], 'rust-small'],
      [['crates/a/src/lib.rs', 'docs/a.md', 'infra/a.ts'], 'rust-small'],
      [Array.from({ length: 5 }, (_, i) => `crates/c${i}/src/lib.rs`), 'rust-medium'],
      [Array.from({ length: 10 }, (_, i) => `crates/c${i}/src/lib.rs`), 'rust-large'],
      [['Cargo.lock'], 'rust-large'],
    ];
    for (const [paths, expected] of cases) {
      assert.equal(classifyFiles(paths)[0], expected, paths.join());
    }
  });

  test('nested crates count separately', () => {
    const paths = Array.from({ length: 4 }, (_, i) => `crates/client/c${i}/src/lib.rs`);
    assert.deepEqual(classifyFiles(paths), ['rust-medium', 4]);
  });

  test('one crate counts once across its directories', () => {
    const paths = ['crates/a/src/lib.rs', 'crates/a/tests/b.rs', 'crates/a/Cargo.toml'];
    assert.deepEqual(classifyFiles(paths), ['rust-small', 1]);
  });

  test('a migration counts as Rust', () => {
    assert.equal(classifyFiles(['crates/db/migrations/1_a.sql'])[0], 'rust-small');
  });

  test('xtask Rust counts as Rust, not infra', () => {
    assert.equal(classifyFiles(['tooling/xtask/src/a.rs'])[0], 'rust-small');
  });
});

describe('clockStart', () => {
  test('the push starts the clock', () => {
    const dayBefore = new Date(when(0).getTime() - 86_400_000);
    assert.deepEqual(clockStart(when(0, 10), when(0), dayBefore), [when(0), 'push']);
  });

  test('opening the PR after the push starts the clock', () => {
    assert.deepEqual(clockStart(when(5, 10), when(0), when(5)), [when(5), 'pr_open']);
  });

  test('an old push falls back to the first run', () => {
    assert.deepEqual(clockStart(when(30), when(0), null), [when(30), 'first_run']);
  });

  test('an unknown push falls back to the first run', () => {
    assert.deepEqual(clockStart(when(0), null, when(0)), [when(0), 'first_run']);
  });
});

describe('jobEvents', () => {
  test('a job has queue and volume', () => {
    const steps = [step(DEV_SHELL_STEP, at(1), at(1, 4)), step('instant', at(1), at(1))];
    const events = jobEvents(REPO, run(), [job({ steps })]);
    const { attributes } = events[0];
    assert.equal(attributes.queue_seconds, 20);
    assert.equal(attributes.run_seconds, 240);
    assert.equal(attributes.volume_state, 'warm');
    assert.equal(attributes.runner_profile, 'namespace-profile-linux-large');
    assert.deepEqual(
      events.map((event) => event.attributes.event),
      ['job', 'step']
    );
  });

  test('a slow dev shell means cold', () => {
    const steps = [step(DEV_SHELL_STEP, at(1), at(3))];
    assert.equal(jobEvents(REPO, run(), [job({ steps })])[0].attributes.volume_state, 'cold');
  });

  test("a partial rerun's copy has no queue time", () => {
    const { attributes } = jobEvents(REPO, run(), [job({ created_at: at(9) })])[0];
    assert.ok(!('queue_seconds' in attributes));
  });

  test('a skipped job is left out', () => {
    assert.deepEqual(jobEvents(REPO, run(), [job({ conclusion: 'skipped' })]), []);
  });

  test('trace ids match the exporter', () => {
    // A real run and the id its trace has in Tempo.
    const [traceId, spanId] = traceIds('macro-inc/macro', { id: 42073661884, run_attempt: 1 });
    assert.equal(traceId, '6957c75506a4f45cba526240dd419983');
    assert.equal(spanId.length, 16);
  });
});

describe('pushEvent', () => {
  test('wall is push to last job across workflows', () => {
    const runs = [run(), run({ id: 2, name: 'web' })];
    const jobs = { 1: [job({ completed_at: at(5) })], 2: [job({ name: 'build', completed_at: at(7), id: 12 })] };
    const { at: end, attributes } = push(runs, jobs, { pushed: when(0) });
    assert.equal(attributes.wall_seconds, 420);
    assert.equal(attributes.wall_start, 'push');
    assert.equal(attributes.start_lag_seconds, 10);
    assert.equal(attributes.last_job, 'build');
    assert.equal(attributes.last_workflow, 'web');
    assert.deepEqual(end, when(7));
  });

  test('a roll-up job ends the wall but is not the last job', () => {
    const jobs = {
      1: [
        job({ completed_at: at(5) }),
        job({ name: 'Cloud Storage Status Check', started_at: at(5), completed_at: at(6), id: 12 }),
      ],
    };
    const { attributes } = push([run()], jobs);
    assert.equal(attributes.last_job, 'test');
    assert.equal(attributes.wall_seconds, 350);
  });

  test('the same push gives the same line from either completion', () => {
    const runs = [run(), run({ id: 2, name: 'web' })];
    const jobs = { 1: [job()], 2: [job({ name: 'build', id: 12 })] };
    const first = push(runs, jobs);
    const second = push(runs, jobs, { head: runs[1] });
    assert.equal(first.body, second.body);
    assert.deepEqual(first.at, second.at);
  });

  test('a rerun is flagged and gets a new line', () => {
    const first = push([run()], { 1: [job()] });
    const rerun = push([run({ run_attempt: 2 })], { 1: [job()] });
    assert.equal(rerun.attributes.rerun, true);
    assert.notEqual(first.body, rerun.body);
  });

  test('any failure fails the push', () => {
    const runs = [run(), run({ id: 2, name: 'web', conclusion: 'failure' })];
    const { attributes } = push(runs, { 1: [job()], 2: [job({ id: 12 })] });
    assert.equal(attributes.conclusion, 'failure');
  });

  test("a workflow's newest run decides the conclusion", () => {
    const runs = [run({ conclusion: 'failure' }), run({ id: 2, created_at: at(2) })];
    const { attributes } = push(runs, { 1: [job()], 2: [job({ id: 12 })] });
    assert.equal(attributes.conclusion, 'success');
  });

  test('a later trigger on the same head is flagged', () => {
    const event = push([run()], { 1: [job()] }, { repeat: 1 });
    assert.equal(event.attributes.rerun, true);
    assert.notEqual(event.body, push([run()], { 1: [job()] }).body);
  });

  test('no job ran is no event', () => {
    assert.equal(pushEvent(REPO, run(), [run()], jobsMap({ 1: [] }), null, null, []), null);
  });

  test('an experiment branch is flagged and never named', () => {
    const head = run({ head_branch: 'someone/ci-probe' });
    const { attributes } = push([head], { 1: [job()] });
    assert.equal(attributes.experiment, true);
    assert.ok(!JSON.stringify(attributes).includes('someone'));
  });

  test('no PR is unknown type', () => {
    assert.equal(push([run()], { 1: [job()] }, { files: null }).attributes.pr_type, 'unknown');
  });
});

describe('sameTriggerRuns', () => {
  test('overlapping runs are one group', () => {
    const runs = [run(), run({ id: 2, created_at: at(4, 11), updated_at: at(9) })];
    assert.deepEqual(sameTriggerRuns(runs, runs[1]), [runs, 0]);
  });

  test('a run joining late extends the group', () => {
    const runs = [
      run(),
      run({ id: 2, created_at: at(4), updated_at: at(9) }),
      run({ id: 3, created_at: at(8), updated_at: at(10) }),
    ];
    assert.deepEqual(sameTriggerRuns(runs, runs[2]), [runs, 0]);
  });

  test('an edit after everything finished is its own group', () => {
    const first = run({ updated_at: at(1) });
    const later = run({ id: 2, created_at: at(2), updated_at: at(3) });
    assert.deepEqual(sameTriggerRuns([later, first], first), [[first], 0]);
    assert.deepEqual(sameTriggerRuns([later, first], later), [[later], 1]);
  });

  test('a run still going keeps the group open', () => {
    const first = run({ status: 'in_progress' });
    const later = run({ id: 2, created_at: at(40) });
    assert.deepEqual(sameTriggerRuns([first, later], later), [[first, later], 0]);
  });

  test('a run outside the checks has no group', () => {
    assert.deepEqual(sameTriggerRuns([run()], run({ id: 9 })), [[], 0]);
  });
});

class FakeGithub implements GithubApi {
  responses: Record<string, unknown>;
  calls = 0;
  rateLimit = null;
  rateRemaining = null;

  constructor(responses: Record<string, unknown>) {
    this.responses = responses;
  }

  async get(path: string) {
    this.calls += 1;
    const response = this.responses[path];
    if (response instanceof Error) throw response;
    return response;
  }
}

function responses(...runs: Run[]): Record<string, unknown> {
  return {
    'actions/runs': { workflow_runs: runs },
    'actions/runs/1/attempts/1/jobs': { jobs: [job()] },
    'actions/runs/2/attempts/1/jobs': { jobs: [job({ name: 'build', id: 12 })] },
    'pulls/7': { created_at: at(0), draft: false },
    'pulls/7/files': [{ filename: 'apps/web/a.ts' }],
    activity: [{ after: 'abc', timestamp: at(0, 5) }],
  };
}

describe('collectPush', () => {
  test('waits for every check', async () => {
    const github = new FakeGithub(
      responses(run(), run({ id: 2, status: 'in_progress', conclusion: null }))
    );
    assert.equal(await collectPush(github, REPO, run()), null);
    assert.equal(github.calls, 1);
  });

  test('a finished push is classified', async () => {
    const github = new FakeGithub(responses(run(), run({ id: 2 })));
    const event = await collectPush(github, REPO, run());
    assert.equal(event?.attributes.pr_type, 'web');
    assert.equal(event?.attributes.wall_start, 'push');
  });

  test('a later edit does not hold up the push', async () => {
    const github = new FakeGithub(
      responses(run(), run({ id: 2, created_at: at(40), status: 'in_progress' }))
    );
    const event = await collectPush(github, REPO, run());
    assert.equal(event?.attributes.rerun, false);
  });

  test('cleanup and other events do not block', async () => {
    const github = new FakeGithub(
      responses(
        run(),
        run({ id: 3, name: 'Cleanup Preview', status: 'in_progress' }),
        run({ id: 4, event: 'push', status: 'in_progress' })
      )
    );
    assert.notEqual(await collectPush(github, REPO, run()), null);
  });

  test('a main push has no push event', async () => {
    const github = new FakeGithub({});
    assert.equal(await collectPush(github, REPO, run({ event: 'push' })), null);
    assert.equal(github.calls, 0);
  });

  test('an error keeps the job events', async () => {
    const github = new FakeGithub({ ...responses(run()), 'actions/runs': new Error('boom') });
    const events = await collect(github, REPO, run());
    assert.deepEqual(
      events.map((event) => event.attributes.event),
      ['job']
    );
  });
});

describe('toOtlp', () => {
  test('records are typed and clamped', () => {
    const now = when(59);
    const document = toOtlp(
      [
        {
          body: 'line',
          at: when(0),
          attributes: { a: 1, b: 'x', c: true },
          ids: ['t'.repeat(32), 's'.repeat(16)],
        },
      ],
      now
    );
    const record = document.resourceLogs[0].scopeLogs[0].logRecords[0];
    const oldest = Math.trunc(now.getTime() / 1000) - MAX_EVENT_AGE_SECONDS;
    assert.equal(record.timeUnixNano, `${oldest}000000000`);
    assert.deepEqual(record.attributes, [
      { key: 'a', value: { intValue: '1' } },
      { key: 'b', value: { stringValue: 'x' } },
      { key: 'c', value: { boolValue: true } },
    ]);
    assert.equal(record.traceId, 't'.repeat(32));
  });
});

describe('authorization', () => {
  test("reads the credential step's header form", () => {
    assert.deepEqual(authorization('Authorization=Bearer%20a%2Fb'), [
      'Authorization',
      'Bearer a/b',
    ]);
  });
});
