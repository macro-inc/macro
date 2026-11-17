// When an email end-to-end run posts to Macro Alerts, and what it says. Run by
// xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  browserFindings,
  type Context,
  decide,
  type Decision,
  failedJobs,
  failedSpecs,
  failureMessage,
  type Job,
  jobsLine,
  type Outcome,
  outcome,
  type Point,
  recoveryMessage,
  rustFindings,
  type StreamRun,
} from './email_e2e_alert.ts';

const ALERT = 'Tell Macro Alerts';

const sha = (digit: string) => digit.repeat(40);

/** The minute past ten a run's jobs ended at. */
const at = (minute: number) => `2026-11-17T10:${String(minute).padStart(2, '0')}:00Z`;

const streamRun = (run_number: number, status = 'completed', head = String(run_number % 10)): StreamRun => ({
  id: 1000 + run_number,
  run_number,
  head_sha: sha(head),
  status,
  conclusion: null,
});

const point = (run_number: number, red: boolean, head = String(run_number % 10)): Point => ({
  id: 1000 + run_number,
  run_number,
  head_sha: sha(head),
  red,
});

/** This run: number 10, at commit `aaaa…`, its jobs ended at 10:30. */
const THIS = streamRun(10, 'in_progress', 'a');

type Other = { n: number; is: 'green' | 'red' | 'running' | 'cancelled'; at?: number };

/** Decides this run, with everything known of the others up front. */
function decideThis({
  red,
  others = [],
  attempts = [],
  endedAt = at(30),
}: {
  red: boolean;
  others?: Other[];
  attempts?: ('failure' | 'success')[];
  endedAt?: string;
}): Decision {
  const outcomes = new Map<number, Outcome>(
    others.map(({ n, is, at: minute }) => [
      1000 + n,
      is === 'running' || is === 'cancelled'
        ? { ended: false, why: is }
        : { ended: true, red: is === 'red', endedAt: at(minute ?? 0) },
    ]),
  );
  const decision = decide({
    run: THIS,
    result: { red, endedAt },
    // Newest first, two minutes apart, before this attempt.
    attempts: attempts.map((is, index) => ({ ended: true, red: is === 'failure', endedAt: at(28 - 2 * index) })),
    stream: others.map(({ n }) => streamRun(n)),
    outcomes,
  });
  assert.ok(!('need' in decision), 'every outcome was given');
  return decision as Decision;
}

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

const job = (id: number, name: string, conclusion: string | null, minute = 20): Job => ({
  id,
  name,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
  completed_at: conclusion === null ? null : at(minute),
});

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
      job(6, ALERT, null),
    ]);

    assert.deepEqual(jobs, [
      { name: 'Email end-to-end (1/3)', step: null },
      { name: 'Email end-to-end (2/3)', step: 'run the email end-to-end scenarios' },
      { name: 'Email end-to-end (coverage)', step: 'report the coverage' },
    ]);
  });
});

describe('outcome', () => {
  const run = streamRun(9);

  test('a run ends when its last job other than the alert ends, red when one failed', () => {
    assert.deepEqual(
      outcome(run, [job(1, 'a', 'success', 12), job(2, 'b', 'failure', 18), job(3, ALERT, 'success', 19)], ALERT),
      { ended: true, red: true, endedAt: at(18) },
    );
  });

  test('a failed alert job does not make the run red', () => {
    assert.deepEqual(outcome(run, [job(1, 'a', 'success', 12), job(2, ALERT, 'failure', 13)], ALERT), {
      ended: true,
      red: false,
      endedAt: at(12),
    });
  });

  test('a run with a job still going has not ended', () => {
    assert.deepEqual(
      outcome(streamRun(9, 'in_progress'), [job(1, 'a', 'success'), job(2, 'b', null), job(3, ALERT, null)], ALERT),
      { ended: false, why: 'running' },
    );
  });

  test('a cancelled job in a run whose alert job ran timed out, and is red', () => {
    for (const alert of [job(3, ALERT, 'success'), job(3, ALERT, null)]) {
      assert.deepEqual(outcome(run, [job(1, 'a', 'success', 12), job(2, 'b', 'cancelled', 16), alert], ALERT), {
        ended: true,
        red: true,
        endedAt: at(16),
      });
    }
  });

  test('a run that was cancelled does not count, and one being cancelled has not ended', () => {
    const jobs = [job(1, 'a', 'success'), job(2, 'b', 'cancelled'), job(3, ALERT, 'skipped')];
    assert.deepEqual(outcome(run, jobs, ALERT), { ended: false, why: 'cancelled' });
    assert.deepEqual(
      outcome(streamRun(9, 'in_progress'), [job(1, 'a', 'success'), job(2, 'b', 'cancelled'), { ...job(3, ALERT, null), status: 'queued' }], ALERT),
      { ended: false, why: 'running' },
    );
  });

  test('a run from before the alert job is judged by its jobs, and cancelled when one was', () => {
    assert.deepEqual(outcome(run, [job(1, 'a', 'success', 12), job(2, 'b', 'failure', 14)], ALERT), {
      ended: true,
      red: true,
      endedAt: at(14),
    });
    assert.deepEqual(outcome(run, [job(1, 'a', 'success'), job(2, 'b', 'cancelled')], ALERT), {
      ended: false,
      why: 'cancelled',
    });
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

describe('decide', () => {
  test('the first red run after a green one posts the failure', () => {
    assert.deepEqual(
      decideThis({
        red: true,
        others: [
          { n: 9, is: 'green', at: 20 },
          { n: 8, is: 'red', at: 10 },
        ],
      }),
      { post: 'failure', lastGreen: point(9, false) },
    );
  });

  test('a red run after a red one posts nothing', () => {
    assert.deepEqual(
      decideThis({
        red: true,
        others: [
          { n: 9, is: 'red', at: 20 },
          { n: 8, is: 'green', at: 10 },
        ],
      }),
      { post: null, why: 'run #9 (at 9999999) failed too, and only the first red run of a streak posts' },
    );
  });

  test('the first green run after red ones posts that it passes again, since the first of them', () => {
    assert.deepEqual(
      decideThis({
        red: false,
        others: [
          { n: 9, is: 'red', at: 25 },
          { n: 8, is: 'red', at: 20 },
          { n: 7, is: 'green', at: 10 },
          { n: 6, is: 'red', at: 5 },
        ],
      }),
      { post: 'recovery', failingSince: point(8, true), redRuns: 2, atLeast: false },
    );
  });

  test('a green run after a green one posts nothing', () => {
    assert.equal(decideThis({ red: false, others: [{ n: 9, is: 'green', at: 20 }] }).post, null);
  });

  test('cancelled runs, and older runs still going, are passed over', () => {
    for (const is of ['cancelled', 'running'] as const) {
      assert.deepEqual(
        decideThis({
          red: true,
          others: [
            { n: 9, is },
            { n: 8, is: 'green', at: 10 },
          ],
        }),
        { post: 'failure', lastGreen: point(8, false) },
      );
    }
  });

  test('a run that ends after a newer run has ended posts nothing', () => {
    for (const is of ['red', 'green'] as const) {
      const decision = decideThis({
        red: is === 'red',
        others: [
          { n: 11, is, at: 25 },
          { n: 9, is: is === 'red' ? 'green' : 'red', at: 20 },
        ],
      });
      assert.deepEqual(decision, {
        post: null,
        why: "run #11, which is newer, ended first, so this result is not the branch's latest",
      });
    }
  });

  test('a newer run that is still going, or ended after this one, does not hold it back', () => {
    for (const newer of [{ n: 11, is: 'running' }, { n: 11, is: 'green', at: 35 }] as Other[]) {
      assert.equal(
        decideThis({ red: true, others: [newer, { n: 9, is: 'green', at: 20 }] }).post,
        'failure',
      );
    }
  });

  test('an older run that ended after a newer one is passed over', () => {
    assert.deepEqual(
      decideThis({
        red: false,
        others: [
          { n: 9, is: 'red', at: 20 },
          { n: 8, is: 'green', at: 25 },
          { n: 7, is: 'green', at: 10 },
        ],
      }),
      { post: 'recovery', failingSince: point(9, true), redRuns: 1, atLeast: false },
    );
  });

  test('two runs that end close together: the older posts the failure and the newer that it passes', () => {
    // Run 10 (red) ended at 10:30 and run 11 (green) at 10:31; each decides
    // the same whichever runs first, with the other ended or not.
    assert.deepEqual(
      decideThis({
        red: true,
        others: [
          { n: 11, is: 'green', at: 31 },
          { n: 9, is: 'green', at: 20 },
        ],
      }),
      { post: 'failure', lastGreen: point(9, false) },
    );
    const eleven = streamRun(11, 'in_progress', 'b');
    const outcomes = new Map<number, Outcome>([
      [THIS.id, { ended: true, red: true, endedAt: at(30) }],
      [1009, { ended: true, red: false, endedAt: at(20) }],
    ]);
    assert.deepEqual(
      decide({
        run: eleven,
        result: { red: false, endedAt: at(31) },
        attempts: [],
        stream: [streamRun(10), streamRun(9)],
        outcomes,
      }),
      { post: 'recovery', failingSince: { ...point(10, true), head_sha: sha('0') }, redRuns: 1, atLeast: false },
    );
  });

  test('a re-run that passes after a failed attempt posts that it passes again', () => {
    assert.deepEqual(
      decideThis({ red: false, attempts: ['failure'], others: [{ n: 9, is: 'green', at: 20 }] }),
      { post: 'recovery', failingSince: point(10, true, 'a'), redRuns: 1, atLeast: false },
    );
  });

  test('a re-run that fails after a failed attempt posts nothing', () => {
    assert.deepEqual(
      decideThis({ red: true, attempts: ['failure'], others: [{ n: 9, is: 'green', at: 20 }] }),
      { post: null, why: 'its previous attempt failed too, and only the first red run of a streak posts' },
    );
  });

  test('a re-run that fails after a passing attempt posts, as flaky', () => {
    assert.deepEqual(decideThis({ red: true, attempts: ['success'], others: [{ n: 9, is: 'red', at: 20 }] }), {
      post: 'failure',
      lastGreen: point(10, false, 'a'),
    });
  });

  test('a run that failed in two attempts counts once in the streak a pass ends', () => {
    assert.deepEqual(
      decideThis({
        red: false,
        attempts: ['failure'],
        others: [
          { n: 9, is: 'red', at: 20 },
          { n: 8, is: 'green', at: 10 },
        ],
      }),
      { post: 'recovery', failingSince: point(9, true), redRuns: 2, atLeast: false },
    );
  });

  test('a streak ends at an earlier attempt that passed', () => {
    assert.deepEqual(
      decideThis({ red: false, attempts: ['failure', 'success'], others: [{ n: 9, is: 'red', at: 20 }] }),
      { post: 'recovery', failingSince: point(10, true, 'a'), redRuns: 1, atLeast: false },
    );
  });

  test('with no run before it, a red run posts and a green one does not', () => {
    assert.deepEqual(decideThis({ red: true }), { post: 'failure', lastGreen: null });
    assert.deepEqual(decideThis({ red: false }), {
      post: null,
      why: 'it passed, and no run before it ended',
    });
  });

  test('a streak longer than it looks back is counted as at least that long', () => {
    const others = Array.from({ length: 20 }, (_, index) => ({ n: 9 - index, is: 'red', at: 29 - index }) as Other);
    const decision = decideThis({ red: false, others });
    assert.equal(decision.post, 'recovery');
    assert.deepEqual(decision.post === 'recovery' && [decision.redRuns, decision.atLeast], [15, true]);
  });

  test('it asks for the outcome of a run it needs, and not of one that has not started', () => {
    const stream = [streamRun(11, 'in_progress'), streamRun(12, 'queued'), streamRun(9)];
    const base = { run: THIS, result: { red: true, endedAt: at(30) }, attempts: [], stream };
    assert.deepEqual(decide({ ...base, outcomes: new Map() }), { need: streamRun(11, 'in_progress') });
    assert.deepEqual(
      decide({ ...base, outcomes: new Map([[1011, { ended: false, why: 'running' }]]) }),
      { need: streamRun(9) },
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
      point(9, false, 'b'),
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
      point(9, false, 'a'),
    );

    assert.match(message, /· daily sweep, at `aaaaaaa` fix\(email\): keep the ‹draft› of a reply\n/);
    assert.doesNotMatch(message, /pull\/123|Failed tests/);
    assert.match(message, /from the known-bug report rather than a gating test \(1\)/);
    assert.match(message, /This commit passed in an earlier run: the failure may be flaky\./);
  });

  test('a failure after an earlier attempt of the run passed says so', () => {
    const message = failureMessage(CONTEXT, [], null, point(10, false, 'a'));
    assert.match(message, /An earlier attempt of this run passed: the failure may be flaky\./);
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
      recoveryMessage(CONTEXT, point(7, true), 2, false),
      [
        '✅ Resolved · **Email end-to-end passes again on main** · push of `aaaaaaa` fix(email): keep the ‹draft› of a reply ([#123](https://github.com/o/r/pull/123))',
        'It had failed since `7777777`, in 2 runs. [Run](https://github.com/o/r/actions/runs/1010)',
      ].join('\n'),
    );
    assert.match(
      recoveryMessage(CONTEXT, point(10, true, 'a'), 1, false),
      /It failed on an earlier attempt of this run\./,
    );
    assert.match(
      recoveryMessage({ ...CONTEXT, event: 'schedule' }, point(9, true, 'a'), 1, false),
      /It had failed since `aaaaaaa`, in 1 run\./,
    );
    assert.match(
      recoveryMessage(CONTEXT, point(7, true), 15, true),
      /It had failed for at least 15 runs, since `7777777` or earlier\./,
    );
  });
});
