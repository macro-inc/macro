// Verdicts of the CI gate. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
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
  labelIsStale,
  lostRun,
  NO_RESULT,
  NOT_STARTED,
  runCommand,
  runIdOf,
  runMayReport,
  sameStatus,
  sweepAction,
  PR_CI_PATH,
  START_JOB,
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

  test('a cancelled run reports nothing', () => {
    const outcome = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: GATE_JOB, conclusion: 'cancelled' },
      ],
      HEAD,
      'run-ci',
    );

    assert.equal(outcome, null);
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
    assert.equal(labelBlocker(true, true), null);
    assert.equal(labelBlocker(null, true), null);
  });

  test('a conflicting PR runs no pull_request workflow', () => {
    assert.equal(labelBlocker(false, false), CONFLICTS);
  });

  test('a merge commit from before PR CI, or none, starts nothing', () => {
    assert.equal(labelBlocker(true, false), STALE_MERGE);
    assert.equal(labelBlocker(null, false), STALE_MERGE);
  });

  test('both explanations fit a commit status', () => {
    assert.ok(STALE_MERGE.length <= 140);
    assert.ok(CONFLICTS.length <= 140);
  });
});

describe('labelIsStale', () => {
  const now = Date.parse('2026-11-11T21:00:00Z');

  test('a label start has had no time to take yet is left alone', () => {
    assert.equal(labelIsStale('2026-11-11T20:55:00Z', now), false);
  });

  test('a label still on the PR long after it was added started nothing', () => {
    assert.equal(labelIsStale('2026-11-11T20:33:18Z', now), true);
  });

  test('a label with no recent labelling event is old', () => {
    assert.equal(labelIsStale(null, now), true);
  });
});

describe('lostRun', () => {
  const now = Date.parse('2026-11-11T21:00:00Z');
  const running = {
    state: 'pending',
    description: 'Running on 0123456',
    targetUrl: 'https://github.com/macro-inc/macro/actions/runs/1',
    createdAt: '2026-11-11T20:40:00Z',
  };

  test('a run still going is left alone', () => {
    assert.equal(lostRun(running, { status: 'in_progress', conclusion: null, updatedAt: '2026-11-11T20:59:00Z' }, now), null);
    assert.equal(lostRun(running, null, now), null);
  });

  test('a run that ended without closing its request lost its result', () => {
    assert.equal(
      lostRun(running, { status: 'completed', conclusion: 'cancelled', updatedAt: '2026-11-11T20:50:00Z' }, now),
      'PR CI ended (cancelled) without a result.',
    );
  });

  test('a run that only just ended may be re-running or about to report', () => {
    assert.equal(
      lostRun(running, { status: 'completed', conclusion: 'cancelled', updatedAt: '2026-11-11T20:59:30Z' }, now),
      null,
    );
  });

  test('a request nothing has closed for hours is given up on, run or no run', () => {
    const old = { ...running, createdAt: '2026-11-11T17:00:00Z' };

    assert.equal(lostRun(old, null, now), NO_RESULT);
    assert.equal(
      lostRun(old, { status: 'queued', conclusion: null, updatedAt: '2026-11-11T17:00:00Z' }, now),
      NO_RESULT,
    );
  });

  test('a fork request links to no run and may wait on approval, so it gets a day', () => {
    const fork = { ...running, targetUrl: 'https://github.com/macro-inc/macro/pull/1/checks' };

    assert.equal(lostRun({ ...fork, createdAt: '2026-11-11T17:00:00Z' }, null, now), null);
    assert.equal(lostRun({ ...fork, createdAt: '2026-11-10T20:00:00Z' }, null, now), NO_RESULT);
  });

  test('only an open request can lose its run', () => {
    const passed = { state: 'success', description: 'Passed on 0123456', createdAt: '2026-11-11T17:00:00Z' };
    const notRun = { state: 'pending', description: 'Not run on this commit.', createdAt: '2026-11-11T17:00:00Z' };
    const ended = { status: 'completed', conclusion: 'success', updatedAt: '2026-11-11T17:10:00Z' };

    assert.equal(lostRun(passed, ended, now), null);
    assert.equal(lostRun(notRun, ended, now), null);
    assert.equal(lostRun(undefined, null, now), null);
  });
});

describe('sweepAction', () => {
  const now = Date.parse('2026-11-11T21:00:00Z');
  const notRun = { state: 'pending', description: 'Not run on this commit.', createdAt: '2026-11-11T20:33:04Z' };

  test('a commit nobody asked to run CI on stays as it is', () => {
    assert.equal(sweepAction({ labelledAt: undefined, status: notRun, run: null }, now), null);
    assert.equal(sweepAction({ labelledAt: undefined, status: undefined, run: null }, now), null);
  });

  test('a stale label comes off and the commit says the run never started', () => {
    assert.deepEqual(sweepAction({ labelledAt: '2026-11-11T20:33:18Z', status: notRun, run: null }, now), {
      removeLabel: true,
      failure: NOT_STARTED,
    });
    assert.deepEqual(sweepAction({ labelledAt: '2026-11-11T20:33:18Z', status: undefined, run: null }, now), {
      removeLabel: true,
      failure: NOT_STARTED,
    });
  });

  test('a stale label never overwrites a verdict or a run that is going', () => {
    const passed = { state: 'success', description: 'Passed on 0123456', createdAt: '2026-11-11T20:00:00Z' };
    const running = { state: 'pending', description: 'Running on 0123456', createdAt: '2026-11-11T20:50:00Z' };

    assert.deepEqual(sweepAction({ labelledAt: '2026-11-11T20:33:18Z', status: passed, run: null }, now), {
      removeLabel: true,
      failure: null,
    });
    assert.deepEqual(sweepAction({ labelledAt: '2026-11-11T20:33:18Z', status: running, run: null }, now), {
      removeLabel: true,
      failure: null,
    });
  });

  test('a fresh label is a request start is about to take', () => {
    assert.equal(sweepAction({ labelledAt: '2026-11-11T20:58:00Z', status: notRun, run: null }, now), null);
  });

  test('a lost run fails the commit', () => {
    const running = { state: 'pending', description: 'Running on 0123456', createdAt: '2026-11-11T20:40:00Z' };
    const cancelled = { status: 'completed', conclusion: 'cancelled', updatedAt: '2026-11-11T20:50:00Z' };

    assert.deepEqual(sweepAction({ labelledAt: undefined, status: running, run: cancelled }, now), {
      removeLabel: false,
      failure: 'PR CI ended (cancelled) without a result.',
    });
  });

  test('every explanation fits a commit status with the command to run again', () => {
    const command = runCommand('macro-inc/macro', '123456', 'run-ci');
    for (const reason of [
      NO_RESULT,
  NOT_STARTED,
      'PR CI ended (action_required) without a result.',
      NO_RESULT,
    ]) {
      assert.ok(`${reason} Run again: ${command}`.length <= 140);
    }
  });
});

describe('runMayReport', () => {
  const now = Date.parse('2026-11-11T21:00:00Z');

  test('a run waiting for a runner or going will still report', () => {
    assert.equal(runMayReport({ status: 'queued', createdAt: '2026-11-11T20:45:00Z' }, now), true);
    assert.equal(runMayReport({ status: 'in_progress', createdAt: '2026-11-11T20:45:00Z' }, now), true);
  });

  test('a finished run has said all it will', () => {
    assert.equal(runMayReport({ status: 'completed', createdAt: '2026-11-11T20:45:00Z' }, now), false);
  });

  test('a run GitHub left queued for hours is not coming', () => {
    assert.equal(runMayReport({ status: 'queued', createdAt: '2026-11-11T17:00:00Z' }, now), false);
  });
});

describe('sameStatus', () => {
  const notRun = { state: 'pending', description: 'Not run on this commit.' };

  test('a status start set since the sweep read the PR is a change', () => {
    assert.equal(sameStatus(notRun, { state: 'pending', description: 'Running on 0123456' }), false);
    assert.equal(sameStatus(undefined, notRun), false);
  });

  test('an untouched commit is the same', () => {
    assert.equal(sameStatus(notRun, { ...notRun }), true);
    assert.equal(sameStatus(undefined, undefined), true);
  });
});

describe('runIdOf', () => {
  test('reads the run a status links to', () => {
    assert.equal(runIdOf('https://github.com/macro-inc/macro/actions/runs/43127343042'), '43127343042');
  });

  test('a fork request links to the PR checks, not a run', () => {
    assert.equal(runIdOf('https://github.com/macro-inc/macro/pull/1/checks'), null);
    assert.equal(runIdOf(null), null);
  });
});
