// Verdicts of the CI gate. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { forkOutcome, GATE_JOB, gateOutcome, START_JOB } from './ci_gate.ts';

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
      'acme/repo',
      '12',
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
      'acme/repo',
      '12',
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
      'acme/repo',
      '12',
      'run-ci',
    );
    const failed = forkOutcome(
      [
        { name: START_JOB, conclusion: 'success' },
        { name: GATE_JOB, conclusion: 'failure' },
      ],
      HEAD,
      'acme/repo',
      '12',
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
      'acme/repo',
      '12',
      'run-ci',
    );

    assert.deepEqual(outcome, {
      state: 'failure',
      description: 'Could not start on 0123456. Run: gh api repos/acme/repo/issues/12/labels -f "labels[]=run-ci"',
    });
  });
});
