// Verdicts of the CI gate. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  acceptedAttestations,
  auditFailures,
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
  PR_CI_PATH,
  skippedAttested,
  START_JOB,
  withAttestations,
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

const ATTESTABLE = [
  { id: 'cloud-storage/check', fingerprint: 'aaaaaaaaaaaaaaaa', selected: true },
  { id: 'conventions/ast-grep', fingerprint: 'bbbbbbbbbbbbbbbb', selected: false },
];
const GATE_CHECKS = [
  { id: 'cloud-storage/check', name: 'Cloud Storage / check', matrix: false },
  { id: 'web-app/test', name: 'Web App / Test (', matrix: true },
];

describe('acceptedAttestations', () => {
  const status = (check: string, description: string, state = 'success') => ({
    context: `attested/${check}`,
    state,
    description,
  });

  test('accepts a passing attestation of the job as this run defines it', () => {
    const entries = acceptedAttestations(
      [
        status('cloud-storage/check', 'fp=aaaaaaaaaaaaaaaa in=0123456789abcdef base=1a2b3c4 on a-machine'),
        status('conventions/ast-grep', 'fp=bbbbbbbbbbbbbbbb in=- base=1a2b3c4 on a-machine'),
      ],
      ATTESTABLE,
      'attested/',
    );

    assert.deepEqual(entries, ['cloud-storage/check@0123456789abcdef', 'conventions/ast-grep@-']);
  });

  test('drops an attestation of a job that changed since', () => {
    const entries = acceptedAttestations(
      [status('conventions/ast-grep', 'fp=cccccccccccccccc in=- base=1a2b3c4')],
      ATTESTABLE,
      'attested/',
    );

    assert.deepEqual(entries, []);
  });

  test('takes the newest status, so a later failure withdraws an attestation', () => {
    const entries = acceptedAttestations(
      [
        status('conventions/ast-grep', 'withdrawn', 'failure'),
        status('conventions/ast-grep', 'fp=bbbbbbbbbbbbbbbb in=- base=1a2b3c4'),
      ],
      ATTESTABLE,
      'attested/',
    );

    assert.deepEqual(entries, []);
  });

  test('drops a selected job attested without a digest, and a digest on an unselected job', () => {
    const entries = acceptedAttestations(
      [
        status('cloud-storage/check', 'fp=aaaaaaaaaaaaaaaa in=- base=1a2b3c4'),
        status('conventions/ast-grep', 'fp=bbbbbbbbbbbbbbbb in=0123456789abcdef base=1a2b3c4'),
      ],
      ATTESTABLE,
      'attested/',
    );

    assert.deepEqual(entries, []);
  });

  test('ignores statuses that are not attestations of a known check', () => {
    const entries = acceptedAttestations(
      [
        { context: 'CI gate', state: 'success', description: 'fp=aaaaaaaaaaaaaaaa in=-' },
        status('cloud-storage/test', 'fp=aaaaaaaaaaaaaaaa in=0123456789abcdef'),
        status('conventions/ast-grep', 'looks good to me'),
      ],
      ATTESTABLE,
      'attested/',
    );

    assert.deepEqual(entries, []);
  });
});

describe('skippedAttested', () => {
  test('names an accepted check whose jobs were all skipped', () => {
    const skipped = skippedAttested(
      ['cloud-storage/check@0123456789abcdef', 'web-app/test@0123456789abcdef'],
      GATE_CHECKS,
      [
        { name: 'Cloud Storage / check', conclusion: 'skipped' },
        { name: 'Web App / Test (1/6)', conclusion: 'skipped' },
        { name: 'Web App / Test (2/6)', conclusion: 'skipped' },
      ],
    );

    assert.deepEqual(skipped, ['cloud-storage/check', 'web-app/test']);
  });

  test('leaves out a check path-check sent to a runner after all', () => {
    const skipped = skippedAttested(['cloud-storage/check@0123456789abcdef'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'success' },
    ]);

    assert.deepEqual(skipped, []);
  });

  test('leaves out a skipped job nobody attested', () => {
    const skipped = skippedAttested([], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'skipped' },
    ]);

    assert.deepEqual(skipped, []);
  });
});

describe('auditFailures', () => {
  test('names an attested check that failed when the audit ran it', () => {
    const failures = auditFailures(['cloud-storage/check', 'web-app/test'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'success' },
      { name: 'Web App / Test (1/6)', conclusion: 'success' },
      { name: 'Web App / Test (2/6)', conclusion: 'failure' },
    ]);

    assert.deepEqual(failures, ['web-app/test']);
  });

  test('does not blame a failing job nobody attested', () => {
    const failures = auditFailures([], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'failure' },
    ]);

    assert.deepEqual(failures, []);
  });
});

describe('withAttestations', () => {
  test('a passing verdict says which checks it took on attestation', () => {
    const outcome = withAttestations(
      { state: 'success', description: 'Passed on 0123456' },
      ['cloud-storage/check', 'web-app/test'],
      [],
    );

    assert.deepEqual(outcome, {
      state: 'success',
      description: 'Passed on 0123456, 2 attested: cloud-storage/check, web-app/test',
    });
  });

  test('a failing audit leads with the attested checks that failed', () => {
    const outcome = withAttestations(
      { state: 'failure', description: 'Failed: web-app' },
      [],
      ['web-app/test'],
    );

    assert.deepEqual(outcome, {
      state: 'failure',
      description: 'Attested but failed here: web-app/test. Failed: web-app',
    });
  });

  test('a verdict with nothing attested is unchanged', () => {
    const verdict = { state: 'failure' as const, description: 'Failed: web-app' };

    assert.deepEqual(withAttestations(verdict, [], []), verdict);
  });
});
