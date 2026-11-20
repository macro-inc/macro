// Verdicts of the CI gate. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  acceptedAttestations,
  auditFailures,
  ciSourceChanges,
  CONFLICTS,
  drawAudits,
  labelBlocker,
  newestJobs,
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
  trustedEntries,
  withAttestations,
  withdrawnAttestations,
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
  const base = {
    '.github': 'aaa',
    'tooling/xtask/crates/xtask_workflows': 'bbb',
    'tooling/xtask/crates/gh_workflow': 'ccc',
  };

  test('a fork that left the CI sources alone changes nothing', () => {
    assert.deepEqual(ciSourceChanges({ ...base }, base), []);
  });

  test('names each source whose tree differs', () => {
    assert.deepEqual(ciSourceChanges({ ...base, '.github': 'eee' }, base), ['.github']);
    assert.deepEqual(
      ciSourceChanges(
        { ...base, '.github': 'eee', 'tooling/xtask/crates/gh_workflow': 'fff' },
        base,
      ),
      ['.github', 'tooling/xtask/crates/gh_workflow'],
    );
  });

  test('a source missing on either side counts as changed', () => {
    // A fork that branched before a source existed fails closed until it
    // merges main.
    const { 'tooling/xtask/crates/gh_workflow': _, ...beforeVendoring } = base;
    assert.deepEqual(ciSourceChanges(beforeVendoring, base), [
      'tooling/xtask/crates/gh_workflow',
    ]);
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
  { id: 'cloud-storage/check', fingerprint: 'aaaaaaaaaaaaaaaa' },
  { id: 'conventions/ast-grep', fingerprint: 'bbbbbbbbbbbbbbbb' },
];
// The tree of the merge commit the run tests, and another one.
const TREE = '1a2b3c4d'.repeat(5);
const OTHER_TREE = '9'.repeat(40);
const GATE_CHECKS = [
  { id: 'cloud-storage/check', name: 'Cloud Storage / check' },
  { id: 'web-app/cycles', name: 'Web App / Cycles Import Check' },
];

describe('acceptedAttestations', () => {
  const status = (check: string, description: string, state = 'success') => ({
    context: `attested/${check}`,
    state,
    description,
  });
  const accepted = (statuses: { context: string; state: string; description: string | null }[]) =>
    acceptedAttestations(statuses, ATTESTABLE, 'attested/', TREE);

  test('accepts a pass of the check as this run defines it, on the tree this run tests', () => {
    const entries = accepted([
      status('cloud-storage/check', `fp=aaaaaaaaaaaaaaaa tree=${TREE}`),
      status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${TREE}`),
    ]);

    assert.deepEqual(entries, ['cloud-storage/check', 'conventions/ast-grep']);
  });

  test('drops a pass on another tree: a commit or main changed a file since', () => {
    const entries = accepted([status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${OTHER_TREE}`)]);

    assert.deepEqual(entries, []);
  });

  test('drops a pass of a check that was defined differently', () => {
    const entries = accepted([status('conventions/ast-grep', `fp=cccccccccccccccc tree=${TREE}`)]);

    assert.deepEqual(entries, []);
  });

  test('a failure on the same tree is final, whatever was posted before or after', () => {
    const pass = status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${TREE}`);
    const fail = status(
      'conventions/ast-grep',
      `fp=bbbbbbbbbbbbbbbb tree=${TREE} failed on a runner`,
      'failure',
    );

    assert.deepEqual(accepted([fail, pass]), []);
    assert.deepEqual(accepted([pass, fail, pass]), []);
  });

  test('a failure on another tree withdraws nothing here', () => {
    const entries = accepted([
      status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${OTHER_TREE} failed on a runner`, 'failure'),
      status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${TREE}`),
    ]);

    assert.deepEqual(entries, ['conventions/ast-grep']);
  });

  test('reads a context in another case as the same check, as GitHub does', () => {
    const entries = accepted([
      {
        context: 'Attested/Conventions/ast-grep',
        state: 'failure',
        description: `fp=bbbbbbbbbbbbbbbb tree=${TREE}`,
      },
      status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${TREE}`),
    ]);

    assert.deepEqual(entries, []);
  });

  test('ignores statuses that are not attestations of a known check', () => {
    const entries = accepted([
      { context: 'CI gate', state: 'success', description: `fp=aaaaaaaaaaaaaaaa tree=${TREE}` },
      status('cloud-storage/test', `fp=aaaaaaaaaaaaaaaa tree=${TREE}`),
      status('conventions/ast-grep', 'looks good to me'),
      status('cloud-storage/check', 'fp=aaaaaaaaaaaaaaaa tree=1a2b3c4d'),
      status('cloud-storage/check', `fp=aaaaaaaaaaaaaaaa tree=${TREE}0`),
    ]);

    assert.deepEqual(entries, []);
  });

  test('accepts nothing when the tree this run tests is unknown', () => {
    const entries = acceptedAttestations(
      [status('conventions/ast-grep', `fp=bbbbbbbbbbbbbbbb tree=${TREE}`)],
      ATTESTABLE,
      'attested/',
      '',
    );

    assert.deepEqual(entries, []);
  });
});

describe('drawAudits', () => {
  const accepted = ['cloud-storage/check', 'conventions/ast-grep', 'web-app/cycles'];

  test('draws each check by itself, and runs the drawn ones on runners', () => {
    const rolls = [3, 0, 7];
    const drawn = drawAudits(accepted, 10, () => rolls.shift() ?? 1);

    assert.deepEqual(drawn, {
      attested: ['cloud-storage/check', 'web-app/cycles'],
      audited: ['conventions/ast-grep'],
    });
  });

  test('asks for a number below the rate', () => {
    const asked: number[] = [];
    drawAudits(accepted, 10, (below) => {
      asked.push(below);
      return 1;
    });

    assert.deepEqual(asked, [10, 10, 10]);
  });

  test('audits nothing when nothing was accepted', () => {
    assert.deepEqual(drawAudits([], 10, () => 0), { attested: [], audited: [] });
  });
});

describe('skippedAttested', () => {
  test('names an accepted check whose job was skipped', () => {
    const skipped = skippedAttested(['cloud-storage/check', 'web-app/cycles'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'skipped' },
      { name: 'Web App / Cycles Import Check', conclusion: 'skipped' },
    ]);

    assert.deepEqual(skipped, ['cloud-storage/check', 'web-app/cycles']);
  });

  test('leaves out a check that ran here, and a skipped job nobody attested', () => {
    const skipped = skippedAttested(['cloud-storage/check'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'success' },
      { name: 'Web App / Cycles Import Check', conclusion: 'skipped' },
    ]);

    assert.deepEqual(skipped, []);
  });
});

describe('auditFailures', () => {
  test('names an attested check that failed when the audit ran it', () => {
    const failures = auditFailures(['cloud-storage/check', 'web-app/cycles'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'success' },
      { name: 'Web App / Cycles Import Check', conclusion: 'failure' },
    ]);

    assert.deepEqual(failures, ['web-app/cycles']);
  });

  test('counts a job that timed out or was cancelled, and not one the change skips', () => {
    const failures = auditFailures(['cloud-storage/check', 'web-app/cycles'], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'skipped' },
      { name: 'Web App / Cycles Import Check', conclusion: 'timed_out' },
    ]);

    assert.deepEqual(failures, ['web-app/cycles']);
  });

  test('does not blame a failing job nobody attested', () => {
    const failures = auditFailures([], GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'failure' },
    ]);

    assert.deepEqual(failures, []);
  });
});

describe('withdrawnAttestations', () => {
  const entries = ['cloud-storage/check', 'conventions/ast-grep'];

  test('names a check whose attestation no longer holds', () => {
    assert.deepEqual(withdrawnAttestations(entries, ['cloud-storage/check']), ['conventions/ast-grep']);
  });

  test('names nothing while every attestation Start accepted still holds', () => {
    assert.deepEqual(withdrawnAttestations(entries, [...entries, 'web-app/cycles']), []);
  });
});

describe('trustedEntries', () => {
  const entries = ['cloud-storage/check', 'web-app/cycles'];

  test('leaves out a check that ran and passed here after all', () => {
    const trusted = trustedEntries(entries, GATE_CHECKS, [
      { name: 'Cloud Storage / check', conclusion: 'success' },
      { name: 'Web App / Cycles Import Check', conclusion: 'skipped' },
    ]);

    assert.deepEqual(trusted, ['web-app/cycles']);
  });

  test('keeps a check whose job is skipped, failed or not listed', () => {
    const trusted = trustedEntries(entries, GATE_CHECKS, [
      { name: 'Web App / Cycles Import Check', conclusion: 'failure' },
    ]);

    assert.deepEqual(trusted, entries);
  });
});

describe('newestJobs', () => {
  test('keeps each job as the newest attempt that ran it left it', () => {
    const jobs = newestJobs([
      { name: 'Web App / Test (1/6)', conclusion: 'failure', run_attempt: 1 },
      { name: 'Cloud Storage / check', conclusion: 'skipped', run_attempt: 1 },
      { name: 'CI gate', conclusion: 'failure', run_attempt: 1 },
      { name: 'CI gate', conclusion: null, run_attempt: 2 },
    ]);

    assert.deepEqual(jobs, [
      { name: 'Web App / Test (1/6)', conclusion: 'failure', run_attempt: 1 },
      { name: 'Cloud Storage / check', conclusion: 'skipped', run_attempt: 1 },
      { name: 'CI gate', conclusion: null, run_attempt: 2 },
    ]);
  });

  test('keeps the record that did not pass when no attempt number tells two apart', () => {
    const failed = { name: 'Web App / Test (1/6)', conclusion: 'failure' };
    const passed = { name: 'Web App / Test (1/6)', conclusion: 'success' };

    assert.deepEqual(newestJobs([failed, passed]), [failed]);
    assert.deepEqual(newestJobs([passed, failed]), [failed]);
  });

  test('a job listed as skipped and as passed counts as skipped, in either order', () => {
    const skipped = { name: 'Cloud Storage / check', conclusion: 'skipped' };
    const passed = { name: 'Cloud Storage / check', conclusion: 'success' };

    assert.deepEqual(newestJobs([skipped, passed]), [skipped]);
    assert.deepEqual(newestJobs([passed, skipped]), [skipped]);
  });

  test('an audit still names its failure when only the gate runs again', () => {
    const jobs = newestJobs([
      { name: 'Web App / Cycles Import Check', conclusion: 'failure', run_attempt: 1 },
      { name: 'CI gate', conclusion: null, run_attempt: 2 },
    ]);

    assert.deepEqual(auditFailures(['web-app/cycles'], GATE_CHECKS, jobs), ['web-app/cycles']);
  });
});

describe('withAttestations', () => {
  test('a failing audit names two checks and counts the rest, to fit a status', () => {
    const outcome = withAttestations(
      { state: 'failure', description: 'Failed: web-app' },
      [],
      ['web-app/test', 'web-app/cycles', 'infra/check', 'sdk/check-package'],
    );

    assert.equal(
      outcome.description,
      'Attested but failed here: web-app/test, web-app/cycles and 2 more. Failed: web-app',
    );
  });

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
