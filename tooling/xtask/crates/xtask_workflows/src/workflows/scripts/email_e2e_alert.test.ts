// When an email end-to-end run posts to Macro Alerts, and what it says. Run by
// xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  browserFindings,
  type Context,
  decide,
  type Entry,
  failedJobs,
  failedSpecs,
  failureMessage,
  type Job,
  jobsLine,
  LOOK_BACK,
  type Names,
  passed,
  readStream,
  readMore,
  recoveryMessage,
  rustFindings,
  type StreamRun,
  suiteFindings,
} from './email_e2e_alert.ts';

const NAMES: Names = {
  job: 'Tell Macro Alerts',
  post: 'post to Macro Alerts',
  failing: 'the channel shows it failing',
  passing: 'the channel shows it passing',
};

const sha = (digit: string) => digit.repeat(40);

/** A minute past ten. */
const at = (minute: number) => `2026-11-17T10:${String(minute).padStart(2, '0')}:00Z`;

const streamRun = (run_number: number, head = String(run_number % 10)): StreamRun => ({
  id: 1000 + run_number,
  run_number,
  head_sha: sha(head),
});

/** This run: number 10, at commit `aaaa…`. */
const THIS = streamRun(10, 'a');

const job = (id: number, name: string, conclusion: string | null, attempt = 1): Job => ({
  id,
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  run_attempt: attempt,
});

/**
 * An alert job that ended at `minute`: whether it posted, and what it recorded
 * the channel shows. One that records nothing failed to post.
 */
const alert = ({
  minute,
  posted = false,
  shows,
  attempt = 1,
}: {
  minute: number;
  posted?: boolean;
  shows?: 'failing' | 'passing';
  attempt?: number;
}): Job => {
  const step = (name: string, ran: boolean, failed = false) => ({
    name,
    conclusion: failed ? 'failure' : ran ? 'success' : 'skipped',
    completed_at: at(minute),
  });
  return {
    ...job(9000 + minute, NAMES.job, shows ? 'success' : 'failure', attempt),
    steps: [
      step('decide what to post', true),
      step(NAMES.post, posted || !shows, !shows),
      step(NAMES.failing, shows === 'failing'),
      step(NAMES.passing, shows === 'passing'),
    ],
  };
};

/** A run of the stream: its suite's result, and its alert jobs. */
const entry = (n: number, suite: 'green' | 'red' | 'running', alerts: Job[] = [], head?: string): Entry => ({
  run: streamRun(n, head),
  jobs: [
    job(n * 10, 'Email end-to-end (1/3)', suite === 'running' ? null : suite === 'red' ? 'failure' : 'success'),
    ...alerts,
  ],
});

const decideThis = (red: boolean, entries: Entry[], run = THIS) => decide({ run, red, entries, names: NAMES });

const CONTEXT: Context = {
  runId: THIS.id,
  workflow: 'Email end-to-end',
  event: 'push',
  branch: 'main',
  sha: sha('a'),
  title: 'fix(email): keep the <draft> of a reply (#123)',
  repoUrl: 'https://github.com/o/r',
  runUrl: 'https://github.com/o/r/actions/runs/1010',
};

describe('failedJobs', () => {
  test('names each failed job and the step it failed at, in the order the run started them', () => {
    const jobs = failedJobs([
      {
        ...job(5, 'Email end-to-end (coverage)', 'failure'),
        steps: [{ name: 'report the coverage', conclusion: 'failure' }],
      },
      {
        ...job(2, 'Email end-to-end (2/3)', 'failure'),
        steps: [
          { name: 'build the services', conclusion: 'success' },
          { name: 'run the email end-to-end scenarios', conclusion: 'failure' },
          { name: 'show sccache stats', conclusion: 'success' },
        ],
      },
      { ...job(1, 'Email end-to-end (1/3)', 'cancelled'), steps: [] },
      job(3, 'Email end-to-end (3/3)', 'success'),
      job(4, 'Email end-to-end (known bugs)', 'skipped'),
      job(6, NAMES.job, null),
    ]);

    assert.deepEqual(jobs, [
      { name: 'Email end-to-end (1/3)', step: null },
      { name: 'Email end-to-end (2/3)', step: 'run the email end-to-end scenarios' },
      { name: 'Email end-to-end (coverage)', step: 'report the coverage' },
    ]);
  });
});

describe('passed', () => {
  test('a run passed when the latest attempt of each job but the alert job did', () => {
    const run = streamRun(9);
    const jobs = [
      job(1, 'a', 'failure', 1),
      job(2, 'b', 'success', 1),
      job(3, NAMES.job, 'failure', 1),
      job(4, 'a', 'success', 2),
    ];
    assert.equal(passed({ run, jobs }, NAMES.job), true);
    assert.equal(passed({ run, jobs: jobs.slice(0, 3) }, NAMES.job), false);
    assert.equal(passed({ run, jobs: [...jobs, job(5, 'b', null, 2)] }, NAMES.job), null);
    assert.equal(passed({ run, jobs: [] }, NAMES.job), null);
  });
});

describe('decide', () => {
  test('with nothing recorded, a red run posts the failure and names the last run that passed', () => {
    assert.deepEqual(decideThis(true, [entry(9, 'running'), entry(8, 'red'), entry(7, 'green')]), {
      post: 'failure',
      failing: true,
      lastGreen: streamRun(7),
    });
  });

  test('with nothing recorded, a green run posts nothing', () => {
    assert.deepEqual(decideThis(false, [entry(9, 'red')]), {
      post: null,
      failing: false,
      why: 'it passed, and the channel was never told otherwise',
    });
  });

  test('a red run posts the failure when the channel shows the stream passing', () => {
    assert.deepEqual(decideThis(true, [entry(9, 'green', [alert({ minute: 20, shows: 'passing' })])]), {
      post: 'failure',
      failing: true,
      lastGreen: streamRun(9),
    });
  });

  test('a red run posts nothing when the channel already shows it failing', () => {
    assert.deepEqual(
      decideThis(true, [entry(9, 'red', [alert({ minute: 20, posted: true, shows: 'failing' })])]),
      { post: null, failing: true, why: 'the channel already shows it failing (since run #9, at 9999999)' },
    );
  });

  test('a green run posts that it passes again, since the run that posted the failure', () => {
    const entries = [
      entry(9, 'red', [alert({ minute: 25, shows: 'failing' })]),
      entry(8, 'red', [alert({ minute: 20, posted: true, shows: 'failing' })]),
      entry(7, 'green', [alert({ minute: 10, shows: 'passing' })]),
    ];
    assert.deepEqual(decideThis(false, entries), {
      post: 'recovery',
      failing: false,
      failingSince: streamRun(8),
    });
  });

  test('a green run posts nothing when the channel shows it passing', () => {
    assert.equal(decideThis(false, [entry(9, 'green', [alert({ minute: 20, shows: 'passing' })])]).post, null);
  });

  test('the channel shows what the alert job that ended last recorded, whatever its run', () => {
    const entries = [
      entry(9, 'green', [alert({ minute: 20, posted: true, shows: 'passing' })]),
      entry(8, 'red', [alert({ minute: 25, posted: true, shows: 'failing', attempt: 2 })]),
    ];
    assert.equal(decideThis(false, entries).post, 'recovery');
    assert.equal(decideThis(true, entries).post, null);
  });

  test('a run posts nothing once a newer run has told the channel, and leaves it as it is', () => {
    const entries = [
      entry(11, 'red', [alert({ minute: 25, posted: true, shows: 'failing' })]),
      entry(9, 'green', [alert({ minute: 20, shows: 'passing' })]),
    ];
    for (const red of [true, false]) {
      assert.deepEqual(decideThis(red, entries), {
        post: null,
        failing: true,
        why: "run #11, which is newer, has ended, so this result is not the branch's latest",
      });
    }
  });

  test('a newer run that has ended holds this one back before its own alert job runs', () => {
    // Its alert job waits behind this one, or was replaced by it, and tells
    // the channel itself, or leaves that to the next run.
    for (const alerts of [[], [alert({ minute: 25 })]]) {
      const entries = [entry(11, 'red', alerts), entry(9, 'green', [alert({ minute: 20, shows: 'passing' })])];
      assert.deepEqual(decideThis(true, entries), {
        post: null,
        failing: false,
        why: "run #11, which is newer, has ended, so this result is not the branch's latest",
      });
    }
  });

  test('a newer run still going does not hold this one back', () => {
    const entries = [entry(12, 'running'), entry(9, 'green', [alert({ minute: 20, shows: 'passing' })])];
    assert.equal(decideThis(true, entries).post, 'failure');
  });

  test('a failed post records nothing, so a re-run of the job posts again', () => {
    const entries = [
      entry(10, 'red', [alert({ minute: 25 })], 'a'),
      entry(9, 'green', [alert({ minute: 20, shows: 'passing' })]),
    ];
    assert.deepEqual(decideThis(true, entries), { post: 'failure', failing: true, lastGreen: streamRun(9) });
  });

  test('a re-run that passes after its first attempt posted the failure posts that it passes again', () => {
    const entries = [
      entry(10, 'red', [alert({ minute: 25, posted: true, shows: 'failing' })], 'a'),
      entry(9, 'green', [alert({ minute: 20, shows: 'passing' })]),
    ];
    assert.deepEqual(decideThis(false, entries), { post: 'recovery', failing: false, failingSince: THIS });
  });

  test('a re-run of an older run that ends after a newer run told the channel posts nothing', () => {
    // Run 9 posted its failure; run 10 passed while run 9 was re-run, and
    // posted that it passes again; run 9's re-run then passes too.
    const entries = [
      entry(10, 'green', [alert({ minute: 40, posted: true, shows: 'passing' })], 'a'),
      entry(9, 'green', [alert({ minute: 25, posted: true, shows: 'failing' })]),
      entry(8, 'green', [alert({ minute: 10, shows: 'passing' })]),
    ];
    const decision = decideThis(false, entries, streamRun(9));
    assert.equal(decision.post, null);
    assert.equal(decision.failing, false);
  });
});

describe('readStream', () => {
  /** Reads a stream whose runs have the jobs `jobs` gives, and which runs it read. */
  const read = async (stream: StreamRun[], red: boolean, jobs: (run: StreamRun) => Job[], run = THIS) => {
    const asked: number[] = [];
    const decision = await readStream(
      stream,
      NAMES,
      (entries) => decideThis(red, entries, run),
      async (each) => {
        asked.push(each.run_number);
        return jobs(each);
      },
    );
    return { decision, asked };
  };

  test('reads past pushes replaced while they waited, to the pass before them', async () => {
    // Run 100 fails; 99 to 60 were replaced while they waited, and started no job.
    const run = streamRun(100, 'a');
    const stream = Array.from({ length: 42 }, (_, i) => streamRun(100 - i));
    const jobs = (each: StreamRun) =>
      each.run_number === 100
        ? entry(100, 'red').jobs
        : each.run_number === 59
          ? entry(59, 'green', [alert({ minute: 5, shows: 'passing' })]).jobs
          : [];
    const { decision } = await read(stream, true, jobs, run);

    assert.equal(decision.post, 'failure');
    const lastGreen = decision.post === 'failure' ? decision.lastGreen : null;
    assert.equal(lastGreen?.run_number, 59);
    // The changes since the last pass span the replaced pushes' commits.
    assert.match(failureMessage(CONTEXT, [], null, lastGreen), new RegExp(`compare/${sha('9')}\\.\\.\\.${sha('a')}`));
  });

  test('reads a run whose job ran out of time for what it recorded, though the run was cancelled', async () => {
    // The runs API lists run 11 as cancelled: a job of it ran out of time.
    const run = streamRun(12, 'a');
    const timedOut = Object.assign(streamRun(11), { conclusion: 'cancelled' });
    const jobs = (each: StreamRun) =>
      each.run_number === 11
        ? [job(110, 'Email end-to-end (1/3)', 'cancelled'), alert({ minute: 30, posted: true, shows: 'failing' })]
        : each.run_number === 10
          ? entry(10, 'green', [alert({ minute: 20, shows: 'passing' })]).jobs
          : entry(12, 'green').jobs;
    const { decision } = await read([run, timedOut, streamRun(10)], false, jobs, run);

    assert.equal(decision.post, 'recovery');
    assert.equal(decision.post === 'recovery' && decision.failingSince?.run_number, 11);
  });

  test('stops at LOOK_BACK runs with jobs, and counts no replaced push toward them', async () => {
    const stream = Array.from({ length: 100 }, (_, i) => streamRun(100 - i));
    // Nothing recorded, so only the bound stops it.
    const ran = await read(stream, false, (each) => entry(each.run_number, 'green').jobs);
    assert.equal(ran.asked.length, LOOK_BACK);

    // Three of every four replaced: 25 runs with jobs, fewer than LOOK_BACK, so it reads the whole listing.
    const replaced = await read(stream, false, (each) =>
      each.run_number % 4 === 0 ? entry(each.run_number, 'green').jobs : [],
    );
    assert.equal(replaced.asked.length, stream.length);
  });
});

describe('readMore', () => {
  test('reads on until something was recorded, and until the message has what it names', () => {
    const recorded = [entry(9, 'green', [alert({ minute: 20, shows: 'passing' })])];
    const failure = { post: 'failure', failing: true } as const;
    const recovery = { post: 'recovery', failing: false } as const;
    const quiet = { post: null, failing: false, why: '' };
    assert.equal(readMore(quiet, [], NAMES), true);
    assert.equal(readMore(quiet, recorded, NAMES), false);
    assert.equal(readMore({ ...failure, lastGreen: null }, recorded, NAMES), true);
    assert.equal(readMore({ ...failure, lastGreen: streamRun(9) }, recorded, NAMES), false);
    assert.equal(readMore({ ...recovery, failingSince: null }, recorded, NAMES), true);
    assert.equal(readMore({ ...recovery, failingSince: streamRun(9) }, recorded, NAMES), false);
  });
});

describe('jobsLine', () => {
  test('names jobs by what follows the workflow name, together when they failed at one step', () => {
    const line = jobsLine('Email end-to-end', [
      { name: 'Email end-to-end (1/3)', step: 'run the email end-to-end scenarios' },
      { name: 'Email end-to-end (2/3)', step: 'run the email end-to-end scenarios' },
      { name: 'Email end-to-end (coverage)', step: 'report the coverage' },
      { name: 'Email end-to-end (search)', step: null },
    ]);

    assert.equal(
      line,
      '1/3, 2/3 at “run the email end-to-end scenarios”; coverage at “report the coverage”; search',
    );
  });

  test('a job named as its workflow keeps its name', () => {
    const workflow = 'Email end-to-end (full stack)';
    assert.equal(
      jobsLine(workflow, [{ name: workflow, step: 'run the full-stack tier' }]),
      'Email end-to-end (full stack) at “run the full-stack tier”',
    );
    assert.equal(
      jobsLine('Email end-to-end (browser)', [
        { name: 'Email end-to-end (browser) coverage', step: 'check the coverage of the email UI' },
      ]),
      'coverage at “check the coverage of the email UI”',
    );
  });
});


describe('findings', () => {
  // `coverage.json` of a failed run, cut to the fields read.
  const coverage = {
    suite: {
      failed: [
        'attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found',
        'sync_ingestion outlook_draft_without_a_sender_gets_its_attachment_stored',
      ],
    },
    broken: [
      'crates/email_e2e/coverage/proofs.tsv: the scenario `search gmail_a_quoted_query_finds_the_exact_phrase` is not in the results',
    ],
    gaps: [
      'scenario `attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found` failed',
      'scenario `sync_ingestion outlook_draft_without_a_sender_gets_its_attachment_stored` failed',
      'scenario `outlook outlook_reply_keeps_its_thread`, kept for a known bug, passes: remove its `#[ignore]` so it gates, and the `bug` line of its function in crates/email_e2e/coverage/functions.toml',
      'function F-021 (Pick up a draft created or changed at the provider) is not proved on gmail: scenarios perform it and none is said to check it',
    ],
  };

  test('the Rust suite: failed scenarios, known bugs that pass, and the rest', () => {
    assert.deepEqual(rustFindings(coverage), {
      failedTests: coverage.suite.failed,
      knownBugsPassing: ['outlook outlook_reply_keeps_its_thread'],
      otherProblems: [coverage.broken[0], coverage.gaps[3]],
    });
  });

  const spec = (title: string, line: number, status: string) => ({
    title,
    file: 'inbox.spec.ts',
    line,
    tests: [{ status }],
  });
  const report = {
    suites: [
      {
        specs: [spec('opens a thread', 10, 'expected')],
        suites: [{ specs: [spec('archives a thread', 20, 'unexpected'), spec('marks read', 30, 'flaky')] }],
      },
    ],
  };

  test('a Playwright report: the specs that failed, however deep', () => {
    assert.deepEqual(failedSpecs(report), ['inbox.spec.ts:20 archives a thread']);
  });

  test('a suite with one report and no coverage check: the specs that failed', () => {
    const marked = (title: string, line: number, status: string) => ({
      title,
      file: 'inbox.spec.ts',
      line,
      tests: [{ status, expectedStatus: 'failed' }],
    });
    const suites = [...report.suites, { specs: [marked('fixed defect', 40, 'unexpected'), marked('defect', 50, 'expected')] }];
    assert.deepEqual(suiteFindings({ suites }), {
      failedTests: [
        'inbox.spec.ts:20 archives a thread',
        'inbox.spec.ts:40 fixed defect (marked as a known defect, and now passes)',
      ],
      knownBugsPassing: [],
      otherProblems: [],
    });
  });

  test('the browser suite: failed tests of the gating runs, once each, and known bugs that pass', () => {
    const findings = browserFindings(
      {
        failures: [
          'a test kept for a known bug passes: remove its @known-bug tag and its waiver: send.spec.ts:5 known bug: outlook-x: sends once',
          'list.archive has no passing test on the per-test stack and no waiver',
        ],
      },
      [
        { name: 'playwright-gating-1.json', report },
        { name: 'playwright-full-stack.json', report },
        { name: 'playwright-known-bugs-1.json', report },
      ],
    );

    assert.deepEqual(findings, {
      failedTests: ['inbox.spec.ts:20 archives a thread'],
      knownBugsPassing: ['send.spec.ts:5 known bug: outlook-x: sends once'],
      otherProblems: ['list.archive has no passing test on the per-test stack and no waiver'],
    });
  });

  test('a failure names the push, its PR, the failed jobs and tests, and the changes since the last pass', () => {
    const message = failureMessage(
      CONTEXT,
      [{ name: 'Email end-to-end (2/3)', step: 'run the email end-to-end scenarios' }],
      rustFindings(coverage),
      streamRun(9, 'b'),
    );

    assert.equal(
      message,
      [
        '🚨 · **Email end-to-end failed on main** · push of `aaaaaaa` fix(email): keep the ‹draft› of a reply ([#123](https://github.com/o/r/pull/123))',
        'Failed jobs: 2/3 at “run the email end-to-end scenarios”',
        'Failed tests (2): `attachment_documents gmail_attachment_of_a_replaced_draft_is_not_found`, `sync_ingestion outlook_draft_without_a_sender_gets_its_attachment_stored`',
        'Kept for a known bug and now passing, from the known-bug report rather than a gating test (1): `outlook outlook_reply_keeps_its_thread`',
        `Last passed at \`bbbbbbb\` · [changes since](https://github.com/o/r/compare/${sha('b')}...${sha('a')})`,
        '[Run](https://github.com/o/r/actions/runs/1010) · [What to do](https://github.com/o/r/blob/main/docs/development/ci.md#when-an-email-end-to-end-alert-fires)',
      ].join('\n'),
    );
  });

  test('a sweep that failed only on a known bug says so, without a PR', () => {
    const message = failureMessage(
      { ...CONTEXT, event: 'schedule' },
      [{ name: 'Email end-to-end (coverage)', step: 'report the coverage' }],
      { failedTests: [], knownBugsPassing: ['outlook outlook_reply_keeps_its_thread'], otherProblems: [] },
      streamRun(9, 'a'),
    );

    assert.match(message, /· daily sweep, at `aaaaaaa` fix\(email\): keep the ‹draft› of a reply\n/);
    assert.doesNotMatch(message, /pull\/123|Failed tests/);
    assert.match(message, /from the known-bug report rather than a gating test \(1\)/);
    assert.match(message, /This commit passed in an earlier run: the failure may be flaky\./);
  });

  test('a failure without failed tests names the first coverage problem, or none at all', () => {
    const jobs = [{ name: 'Email end-to-end (search)', step: 'build the services' }];
    const many = failureMessage(
      CONTEXT,
      jobs,
      { failedTests: [], knownBugsPassing: [], otherProblems: ['first', 'second', 'third'] },
      null,
    );
    const none = failureMessage(CONTEXT, jobs, null, null);

    assert.match(many, /The coverage check failed: first \(and 2 more\)/);
    assert.match(none, /No coverage report was written/);
    assert.doesNotMatch(none, /Last passed/);
  });

  test('more than eight failed tests are counted, not named', () => {
    const failedTests = Array.from({ length: 11 }, (_, index) => `test ${index}`);
    const message = failureMessage(CONTEXT, [], { failedTests, knownBugsPassing: [], otherProblems: [] }, null);

    assert.match(message, /Failed tests \(11\): .*`test 7` and 3 more\n/);
  });

  test('a recovery says since when it had failed', () => {
    assert.equal(
      recoveryMessage(CONTEXT, streamRun(7)),
      [
        '✅ Resolved · **Email end-to-end passes again on main** · push of `aaaaaaa` fix(email): keep the ‹draft› of a reply ([#123](https://github.com/o/r/pull/123))',
        'It had failed since `7777777`. [Run](https://github.com/o/r/actions/runs/1010)',
      ].join('\n'),
    );
    assert.match(recoveryMessage(CONTEXT, THIS), /\nIt failed on an earlier attempt of this run\. \[Run\]/);
    assert.match(
      recoveryMessage({ ...CONTEXT, event: 'schedule' }, streamRun(9, 'a')),
      /\nIt had failed since `aaaaaaa`\. \[Run\]/,
    );
    assert.match(recoveryMessage(CONTEXT, null), /\n\[Run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1010\)$/);
  });
});
