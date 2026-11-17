// When an email end-to-end run posts to Macro Alerts, and what it says. Run by
// xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  browserFindings,
  type Context,
  decide,
  failedJobs,
  failedSpecs,
  failureMessage,
  jobsLine,
  recoveryMessage,
  rustFindings,
  type StreamRun,
} from './email_e2e_alert.ts';

const sha = (digit: string) => digit.repeat(40);

const run = (run_number: number, conclusion: string | null, head = String(run_number)): StreamRun => ({
  id: 1000 + run_number,
  run_number,
  head_sha: sha(head),
  conclusion,
});

const THIS = run(10, null, 'a');

const CONTEXT: Context = {
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
        id: 5,
        name: 'Email end-to-end (coverage)',
        status: 'completed',
        conclusion: 'failure',
        steps: [{ name: 'report the coverage', conclusion: 'failure' }],
      },
      {
        id: 2,
        name: 'Email end-to-end (2/3)',
        status: 'completed',
        conclusion: 'failure',
        steps: [
          { name: 'build the services', conclusion: 'success' },
          { name: 'run the email end-to-end scenarios', conclusion: 'failure' },
          { name: 'show sccache stats', conclusion: 'success' },
        ],
      },
      { id: 1, name: 'Email end-to-end (1/3)', status: 'completed', conclusion: 'cancelled', steps: [] },
      { id: 3, name: 'Email end-to-end (3/3)', status: 'completed', conclusion: 'success' },
      { id: 4, name: 'Email end-to-end (known bugs)', status: 'completed', conclusion: 'skipped' },
      { id: 6, name: 'Tell Macro Alerts', status: 'in_progress', conclusion: null },
    ]);

    assert.deepEqual(jobs, [
      { name: 'Email end-to-end (1/3)', step: null },
      { name: 'Email end-to-end (2/3)', step: 'run the email end-to-end scenarios' },
      { name: 'Email end-to-end (coverage)', step: 'report the coverage' },
    ]);
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
    const decision = decide({
      red: true,
      run: THIS,
      previousAttempt: null,
      history: [run(9, 'success'), run(8, 'failure')],
    });

    assert.deepEqual(decision, { post: 'failure', lastGreen: run(9, 'success') });
  });

  test('a red run after a red one posts nothing', () => {
    const decision = decide({
      red: true,
      run: THIS,
      previousAttempt: null,
      history: [run(9, 'failure'), run(8, 'success')],
    });

    assert.deepEqual(decision, {
      post: null,
      why: 'run #9 (at 9999999) failed too, and only the first red run of a streak posts',
    });
  });

  test('the first green run after red ones posts that it passes again, since the first of them', () => {
    const decision = decide({
      red: false,
      run: THIS,
      previousAttempt: null,
      history: [run(9, 'failure'), run(7, 'timed_out'), run(6, 'success'), run(5, 'failure')],
    });

    assert.deepEqual(decision, { post: 'recovery', failingSince: sha('7'), redRuns: 2 });
  });

  test('a green run after a green one posts nothing', () => {
    const decision = decide({
      red: false,
      run: THIS,
      previousAttempt: null,
      history: [run(9, 'success')],
    });

    assert.equal(decision.post, null);
  });

  test('cancelled runs are passed over', () => {
    const decision = decide({
      red: true,
      run: THIS,
      previousAttempt: null,
      history: [run(9, 'cancelled'), run(8, 'success')],
    });

    assert.deepEqual(decision, { post: 'failure', lastGreen: run(8, 'success') });
  });

  test('a run that ends after a newer run has ended posts nothing', () => {
    for (const red of [true, false]) {
      const decision = decide({
        red,
        run: THIS,
        previousAttempt: null,
        history: [run(11, red ? 'failure' : 'success'), run(9, red ? 'success' : 'failure')],
      });

      assert.equal(decision.post, null);
      assert.match(decision.post === null ? decision.why : '', /run #11/);
    }
  });

  test('a newer run still going does not hold an older one back', () => {
    const decision = decide({
      red: true,
      run: THIS,
      previousAttempt: null,
      history: [run(11, null), run(9, 'success')],
    });

    assert.equal(decision.post, 'failure');
  });

  test('a re-run that passes after a failed attempt posts that it passes again', () => {
    const decision = decide({
      red: false,
      run: THIS,
      previousAttempt: 'failure',
      history: [run(9, 'success')],
    });

    assert.deepEqual(decision, { post: 'recovery', failingSince: sha('a'), redRuns: 1 });
  });

  test('a re-run that fails after a failed attempt posts nothing', () => {
    const decision = decide({
      red: true,
      run: THIS,
      previousAttempt: 'failure',
      history: [run(9, 'success')],
    });

    assert.deepEqual(decision, {
      post: null,
      why: 'its previous attempt failed too, and only the first red run of a streak posts',
    });
  });

  test('a run that failed in two attempts counts once in the streak a pass ends', () => {
    const decision = decide({
      red: false,
      run: THIS,
      previousAttempt: 'failure',
      history: [run(9, 'failure'), run(8, 'success')],
    });

    assert.deepEqual(decision, { post: 'recovery', failingSince: sha('9'), redRuns: 2 });
  });

  test('with no run before it, a red run posts and a green one does not', () => {
    assert.deepEqual(decide({ red: true, run: THIS, previousAttempt: null, history: [] }), {
      post: 'failure',
      lastGreen: null,
    });
    assert.equal(decide({ red: false, run: THIS, previousAttempt: null, history: [] }).post, null);
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
      run(9, 'success', 'b'),
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
      run(9, 'success', 'a'),
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
    const message = failureMessage(
      CONTEXT,
      [],
      { failedTests, knownBugsPassing: [], otherProblems: [] },
      null,
    );

    assert.match(message, /Failed tests \(11\): .*`test 7` and 3 more\n/);
  });

  test('a recovery says since when it had failed', () => {
    assert.equal(
      recoveryMessage(CONTEXT, sha('7'), 2),
      [
        '✅ Resolved · **Email end-to-end passes again on main** · push of `aaaaaaa` fix(email): keep the ‹draft› of a reply ([#123](https://github.com/o/r/pull/123))',
        'It had failed since `7777777`, in 2 runs. [Run](https://github.com/o/r/actions/runs/1010)',
      ].join('\n'),
    );
    assert.match(recoveryMessage(CONTEXT, sha('a'), 1), /It failed on an earlier attempt of this run\./);
  });
});
