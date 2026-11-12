// Scenarios for the CI telemetry collector and sender. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  CACHE_STATS_ARTIFACT,
  type CacheStats,
  cacheStats,
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
  readZipEntry,
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

  async download(path: string) {
    this.calls += 1;
    const response = this.responses[path];
    if (response instanceof Error) throw response;
    assert.ok(response instanceof Uint8Array, path);
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

  test('a run without its PR still finds the PR through its group', async () => {
    const last = run({ id: 2, pull_requests: [] });
    const github = new FakeGithub(responses(run(), last));
    const event = await collectPush(github, REPO, last);
    assert.equal(event?.attributes.pr_type, 'web');
    assert.equal(event?.attributes.pr_number, 7);
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

// sccache 0.16's `--show-stats --stats-format json`, trimmed to the fields read.
function sccacheJson(overrides: Record<string, unknown> = {}) {
  return {
    stats: {
      compile_requests: 120,
      requests_not_cacheable: 7,
      cache_errors: { counts: { Rust: 1 } },
      cache_hits: { counts: { Rust: 90, 'C/C++': 4 } },
      cache_misses: { counts: { Rust: 6 } },
      cache_timeouts: 2,
      cache_read_errors: 0,
      cache_write_errors: 1,
      cache_write_duration: { secs: 3, nanos: 250_000_000 },
      cache_read_hit_duration: { secs: 12, nanos: 5_000_000 },
      compiler_write_duration: { secs: 61, nanos: 999_999_999 },
      ...overrides,
    },
    cache_location: 'WebDAV, endpoint: https://cache.example/secret, key_prefix: x',
    version: '0.16.0',
  };
}

const STATS: CacheStats = {
  sccache_backend: 'remote',
  sccache_requests: 120,
  sccache_hits: 94,
  sccache_misses: 6,
  sccache_hit_percent: 94,
  sccache_errors: 2,
  sccache_timeouts: 2,
  sccache_not_cacheable: 7,
  sccache_read_ms: 12005,
  sccache_write_ms: 3250,
  sccache_compile_ms: 61999,
};

/**
 * A one-file zip as upload-artifact writes it: deflated, with the sizes in a data
 * descriptor after the data and only the central directory saying them up front.
 */
function zipOf(name: string, content: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(content));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0x0008, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBytes.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(content.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0008, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + data.length + descriptor.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return new Uint8Array(
    Buffer.concat([local, nameBytes, data, descriptor, central, nameBytes, end])
  );
}

describe('cacheStats', () => {
  test('sums every language and keeps only numbers', () => {
    const stats = cacheStats(sccacheJson());
    assert.deepEqual(stats, STATS);
    assert.ok(!JSON.stringify(stats).includes('example'));
  });

  test('a local disk cache is local', () => {
    const document = { ...sccacheJson(), cache_location: 'Local disk: "/home/runner/.cache"' };
    assert.equal(cacheStats(document)?.sccache_backend, 'local');
  });

  test('a job that compiled nothing has no stats', () => {
    assert.equal(cacheStats(sccacheJson({ compile_requests: 0 })), null);
  });

  test('no hits or misses has no hit percent', () => {
    const stats = cacheStats(
      sccacheJson({ cache_hits: { counts: {} }, cache_misses: { counts: {} } })
    );
    assert.ok(stats && !('sccache_hit_percent' in stats));
  });

  test('anything but whole non-negative numbers is refused', () => {
    for (const bad of [
      { compile_requests: '120' },
      { compile_requests: -1 },
      { compile_requests: 1.5 },
      { cache_hits: { counts: { Rust: 'many' } } },
      { cache_misses: [] },
      { cache_write_duration: { secs: 1 } },
    ]) {
      assert.equal(cacheStats(sccacheJson(bad)), null, JSON.stringify(bad));
    }
    assert.equal(cacheStats('not an object'), null);
    assert.equal(cacheStats({ stats: [] }), null);
  });

  test('an unknown cache location is refused', () => {
    assert.equal(cacheStats({ ...sccacheJson(), cache_location: 7 }), null);
  });
});

describe('readZipEntry', () => {
  test('reads a streamed, deflated entry', () => {
    assert.equal(readZipEntry(zipOf('sccache.json', '{"a":1}'), 'sccache.json', 1024), '{"a":1}');
  });

  test('another file name is not read', () => {
    assert.equal(readZipEntry(zipOf('other.json', '{}'), 'sccache.json', 1024), null);
  });

  test('an entry over the limit is not read', () => {
    assert.equal(readZipEntry(zipOf('sccache.json', 'x'.repeat(2000)), 'sccache.json', 1024), null);
  });

  test('bytes that are not a zip are not read', () => {
    assert.equal(readZipEntry(new Uint8Array([1, 2, 3]), 'sccache.json', 1024), null);
  });
});

describe('cache stats in job events', () => {
  const jobs = [job(), job({ id: 12, name: 'check' }), job({ id: 13, name: 'lint' })];
  const artifact = (id: number, jobId: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `${CACHE_STATS_ARTIFACT}${jobId}`,
    size_in_bytes: 400,
    expired: false,
    ...overrides,
  });

  test("each job's artifact lands on its job event", async () => {
    const github = new FakeGithub({
      'actions/runs/1/attempts/1/jobs': { jobs },
      'actions/runs/1/artifacts': {
        total_count: 5,
        artifacts: [
          artifact(100, 11),
          artifact(101, 12),
          // Another attempt's job, a build output and an oversized file.
          artifact(102, 99),
          { ...artifact(103, 13), name: 'web-dist' },
          artifact(104, 13, { size_in_bytes: 10_000_000 }),
        ],
      },
      'actions/artifacts/100/zip': zipOf('sccache.json', JSON.stringify(sccacheJson())),
      'actions/artifacts/101/zip': zipOf('sccache.json', '{"stats": "tampered"}'),
    });
    const events = await collect(github, REPO, run({ event: 'push' }));
    const byJob = new Map(
      events
        .filter((event) => event.attributes.event === 'job')
        .map((event) => [event.attributes.job_id, event.attributes])
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(byJob.get(11) ?? {}).filter(([key]) => key.startsWith('sccache_'))
      ),
      STATS
    );
    assert.ok(!('sccache_requests' in (byJob.get(12) ?? {})));
    assert.ok(!('sccache_requests' in (byJob.get(13) ?? {})));
    // One listing and the two downloads it allowed.
    assert.equal(github.calls, 4);
  });

  test('a failed listing keeps the job events', async () => {
    const github = new FakeGithub({
      'actions/runs/1/attempts/1/jobs': { jobs },
      'actions/runs/1/artifacts': new Error('boom'),
    });
    const events = await collect(github, REPO, run({ event: 'push' }));
    assert.equal(events.filter((event) => event.attributes.event === 'job').length, 3);
  });

  test('a failed download keeps the other jobs', async () => {
    const github = new FakeGithub({
      'actions/runs/1/attempts/1/jobs': { jobs },
      'actions/runs/1/artifacts': { total_count: 2, artifacts: [artifact(100, 11), artifact(101, 12)] },
      'actions/artifacts/100/zip': new Error('gone'),
      'actions/artifacts/101/zip': zipOf('sccache.json', JSON.stringify(sccacheJson())),
    });
    const events = await collect(github, REPO, run({ event: 'push' }));
    const check = events.find((event) => event.attributes.job_id === 12);
    assert.equal(check?.attributes.sccache_hits, 94);
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
