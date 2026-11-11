// Verdicts of the CI gate. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  anotherRunGoing,
  ciSourceChanges,
  CONFLICTS,
  labelBlocker,
  STALE_MERGE,
  FORK_CHANGES_CI,
  forkOutcome,
  forkRunDistrust,
  GATE_JOB,
  gateOutcome,
  isOpenRequest,
  NO_VERDICT,
  noVerdict,
  leftWithoutVerdict,
  PR_CI_PATH,
  runCommand,
  START_JOB,
  WRONG_BASE,
} from './ci_gate.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';

describe('gateOutcome', () => {
  test('passes when every called workflow passed or was path-skipped', () => {
    const outcome = gateOutcome(
      {
        start: { result: 'success' },
        'web-app': { result: 'success' },
        'cargo-deny': { result: 'skipped' },
      },
      HEAD,
    );

    assert.deepEqual(outcome, { state: 'success', description: 'Passed on 0123456' });
  });

  test('fails naming every workflow that did not pass', () => {
    const outcome = gateOutcome(
      {
        start: { result: 'success' },
        'web-app': { result: 'failure' },
        'cloud-storage': { result: 'cancelled' },
        infra: { result: 'success' },
      },
      HEAD,
    );

    assert.deepEqual(outcome, { state: 'failure', description: 'Failed: web-app, cloud-storage' });
  });

  test('leaves the status alone when start failed, because start already explained why', () => {
    const outcome = gateOutcome(
      { start: { result: 'failure' }, 'web-app': { result: 'skipped' } },
      HEAD,
    );

    assert.equal(outcome, null);
  });

  test('a skipped start never passes', () => {
    const outcome = gateOutcome(
      { start: { result: 'skipped' }, 'web-app': { result: 'skipped' } },
      HEAD,
    );

    assert.equal(outcome, null);
  });
});

describe('forkOutcome', () => {
  test('an unrelated label run reports nothing', () => {
    const outcome = forkOutcome(
      [
        { name: START_JOB, conclusion: 'skipped' },
        { name: GATE_JOB, conclusion: 'skipped' },
      ],
      HEAD,
      'run-ci',
    );

    assert.equal(outcome, null);
  });

  test('a cancelled request has no verdict, so it is closed unless a newer run took over', () => {
    const cancelledGate = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: GATE_JOB, conclusion: 'cancelled' },
      ],
      HEAD,
      'run-ci',
    );
    const cancelledStart = forkOutcome(
      [
        { name: START_JOB, conclusion: 'cancelled' },
        { name: GATE_JOB, conclusion: 'skipped' },
      ],
      HEAD,
      'run-ci',
    );

    assert.equal(cancelledGate, NO_VERDICT);
    assert.equal(cancelledStart, NO_VERDICT);
  });

  test('a request GitHub ended without its gate job has no verdict', () => {
    const outcome = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: 'Web App / path-check', conclusion: 'success' },
      ],
      HEAD,
      'run-ci',
    );

    assert.equal(outcome, NO_VERDICT);
  });

  test('copies the gate job verdict', () => {
    const passed = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: 'Web App / Typecheck', conclusion: 'success' },
        { name: GATE_JOB, conclusion: 'success' },
      ],
      HEAD,
      'run-ci',
    );
    const failed = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: GATE_JOB, conclusion: 'failure' },
      ],
      HEAD,
      'run-ci',
    );

    assert.equal(passed?.state, 'success');
    assert.equal(failed?.state, 'failure');
  });

  test('a failed start fails with the command to run again', () => {
    const outcome = forkOutcome(
      [
        { name: START_JOB, conclusion: 'failure' },
        { name: GATE_JOB, conclusion: 'failure' },
      ],
      HEAD,
      'run-ci',
    );

    assert.deepEqual(outcome, {
      state: 'failure',
      description: 'Could not start on 0123456. Add the run-ci label again.',
    });
  });
});

describe('isOpenRequest', () => {
  test('only a pending request that no result has closed', () => {
    assert.equal(isOpenRequest({ state: 'pending', description: 'Running on 0123456' }), true);
    assert.equal(isOpenRequest({ state: 'success', description: 'Passed on 0123456' }), false);
    assert.equal(
      isOpenRequest({ state: 'pending', description: 'Not run on this commit. Run: ...' }),
      false,
    );
    assert.equal(isOpenRequest(undefined), false);
  });
});

describe('leftWithoutVerdict', () => {
  const run = { id: 42672631112, run_started_at: '2026-11-09T18:16:43Z' };
  const targetUrl = `https://github.com/macro-inc/macro/actions/runs/${run.id}`;
  const during = '2026-11-09T18:17:18Z';
  const status = (state: string, description: string) => ({
    state,
    description,
    targetUrl,
    createdAt: during,
  });
  const request = status('pending', 'Running on 0123456');

  test("start's request is still open: GitHub never ran the gate job", () => {
    assert.equal(leftWithoutVerdict(request, run), true);
  });

  test('the gate job set a result in this attempt', () => {
    assert.equal(leftWithoutVerdict(status('failure', 'Failed: web-app'), run), false);
  });

  test('a result from an earlier attempt that a re-run never replaced', () => {
    const stale = {
      ...status('failure', 'Failed: node-modules-nix'),
      createdAt: '2026-11-09T17:39:35Z',
    };
    assert.equal(leftWithoutVerdict(stale, run), true);
  });

  test("another run's request or result, or none, is not this run's to close", () => {
    const other = `https://github.com/macro-inc/macro/actions/runs/2672631112`;
    assert.equal(leftWithoutVerdict({ ...request, targetUrl: other }, run), false);
    const notRun = status('pending', 'Not run on this commit. Run: ...');
    assert.equal(leftWithoutVerdict({ ...notRun, targetUrl: other }, run), false);
    assert.equal(leftWithoutVerdict(undefined, run), false);
  });
});

describe('noVerdict', () => {
  const retry = `Run again: ${runCommand('macro-inc/macro', '10147', 'run-ci')}`;

  test('a run GitHub ended without its gate job fails with the command to run again', () => {
    assert.deepEqual(noVerdict('failure', retry), {
      state: 'failure',
      description: `PR CI ended without a verdict. ${retry}`,
    });
  });

  test('a cancelled run says so', () => {
    assert.deepEqual(noVerdict('cancelled', 'Add the run-ci label again.'), {
      state: 'failure',
      description: 'PR CI was cancelled before its verdict. Add the run-ci label again.',
    });
  });

  test('fits a commit status', () => {
    const longest = runCommand('macro-inc/macro', '999999', 'run-ci');
    assert.ok(noVerdict('cancelled', `Run again: ${longest}`).description.length <= 140);
  });
});

describe('anotherRunGoing', () => {
  test('a newer request still queued or running owns the status', () => {
    const queued = [
      { id: 1, status: 'completed' },
      { id: 2, status: 'queued' },
    ];
    const running = [
      { id: 1, status: 'completed' },
      { id: 2, status: 'in_progress' },
    ];
    assert.equal(anotherRunGoing(queued, 1), true);
    assert.equal(anotherRunGoing(running, 1), true);
  });

  test('the run itself, or runs that finished, own nothing', () => {
    assert.equal(anotherRunGoing([{ id: 1, status: 'in_progress' }], 1), false);
    assert.equal(
      anotherRunGoing(
        [
          { id: 1, status: 'completed' },
          { id: 2, status: 'completed' },
        ],
        1,
      ),
      false,
    );
  });
});

describe('ciSourceChanges', () => {
  const base = { '.github': 'aaa', 'tooling/xtask/crates/xtask_workflows': 'bbb' };

  test('a fork that left the CI sources alone changes nothing', () => {
    assert.deepEqual(ciSourceChanges({ ...base }, base), []);
  });

  test('names each source whose tree differs', () => {
    assert.deepEqual(ciSourceChanges({ ...base, '.github': 'ccc' }, base), ['.github']);
    assert.deepEqual(
      ciSourceChanges({ '.github': 'ccc', 'tooling/xtask/crates/xtask_workflows': 'ddd' }, base),
      ['.github', 'tooling/xtask/crates/xtask_workflows'],
    );
  });

  test('a source missing on either side counts as changed', () => {
    assert.deepEqual(ciSourceChanges({ ...base, '.github': null }, base), ['.github']);
    assert.deepEqual(
      ciSourceChanges(base, { ...base, 'tooling/xtask/crates/xtask_workflows': null }),
      ['tooling/xtask/crates/xtask_workflows'],
    );
  });
});

describe('forkRunDistrust', () => {
  test('trusts a pr-ci.yml run of a fork that left the CI sources alone', () => {
    assert.equal(forkRunDistrust(PR_CI_PATH, []), null);
  });

  test('a fork that changed the CI sources fails, whatever its jobs say', () => {
    assert.equal(forkRunDistrust(PR_CI_PATH, ['.github']), FORK_CHANGES_CI);
    assert.equal(forkRunDistrust('.github/workflows/other.yml', ['.github']), FORK_CHANGES_CI);
  });

  test('another workflow named PR CI is not trusted', () => {
    assert.equal(
      forkRunDistrust('.github/workflows/other.yml', []),
      `The run came from .github/workflows/other.yml, not ${PR_CI_PATH}`,
    );
  });
});

describe('labelBlocker', () => {
  test('a mergeable PR whose merge commit holds PR CI can start it', () => {
    assert.equal(labelBlocker('main', true, true), null);
    assert.equal(labelBlocker('main', null, true), null);
  });

  test('a PR into another branch never runs PR CI', () => {
    assert.equal(labelBlocker('feature/base', true, true), WRONG_BASE);
    assert.equal(labelBlocker('feature/base', false, false), WRONG_BASE);
  });

  test('a conflicting PR runs no pull_request workflow', () => {
    assert.equal(labelBlocker('main', false, false), CONFLICTS);
  });

  test('a merge commit from before PR CI, or none, starts nothing', () => {
    assert.equal(labelBlocker('main', true, false), STALE_MERGE);
    assert.equal(labelBlocker('main', null, false), STALE_MERGE);
  });

  test('every explanation fits a commit status', () => {
    assert.ok(STALE_MERGE.length <= 140);
    assert.ok(CONFLICTS.length <= 140);
    assert.ok(WRONG_BASE.length <= 140);
  });
});
