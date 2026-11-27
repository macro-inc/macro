import { expect, test } from 'bun:test';
import { applyBrainEvent, effectReplay } from '../contracts.ts';
import {
  committedEffect,
  firstFinish,
  firstStart,
  queued,
  secondFinish,
  secondStart,
  unknownEffect,
} from './fixture.ts';

test('only the owning job and attempt can finish a running job', () => {
  const running = applyBrainEvent(queued, firstStart);
  const retry = applyBrainEvent(running, firstFinish);
  const resumed = applyBrainEvent(retry, secondStart);

  expect(resumed).toEqual({
    kind: 'running',
    job: queued.job,
    attempt: secondStart.attempt,
  });
  expect(applyBrainEvent(resumed, firstFinish)).toBe(resumed);
  expect(
    applyBrainEvent(resumed, {
      ...secondFinish,
      attempt: { ...secondFinish.attempt, jobId: 'job-2' },
    })
  ).toBe(resumed);
  expect(
    applyBrainEvent(resumed, {
      ...secondFinish,
      attempt: { ...secondFinish.attempt, attemptId: 'other-attempt' },
    })
  ).toBe(resumed);
  expect(
    applyBrainEvent(resumed, {
      ...secondFinish,
      attempt: { ...secondFinish.attempt, leaseEpoch: 1 },
    })
  ).toBe(resumed);
});

test('redelivery leaves retry available and a finished job closed', () => {
  const running = applyBrainEvent(queued, firstStart);
  expect(applyBrainEvent(running, firstStart)).toBe(running);
  expect(applyBrainEvent(running, secondStart)).toBe(running);

  const retry = applyBrainEvent(running, firstFinish);
  expect(retry.kind).toBe('queued');
  expect(applyBrainEvent(retry, firstStart)).toBe(retry);
  expect(applyBrainEvent(retry, firstFinish)).toBe(retry);
  expect(
    applyBrainEvent(retry, {
      ...secondStart,
      attempt: { ...secondStart.attempt, leaseEpoch: 1 },
    })
  ).toBe(retry);

  const finished = [secondStart, secondFinish].reduce(applyBrainEvent, retry);
  expect(finished).toEqual({
    kind: 'finished',
    job: queued.job,
    attempt: secondFinish.attempt,
    outcome: 'succeeded',
    usage: { kind: 'reported', inputTokens: 24, outputTokens: 0 },
  });
  expect(applyBrainEvent(finished, secondFinish)).toBe(finished);
  expect(
    applyBrainEvent(finished, {
      kind: 'attempt_started',
      attempt: {
        jobId: queued.job.jobId,
        attemptId: 'attempt-3',
        leaseEpoch: 3,
      },
    })
  ).toBe(finished);
  expect(
    applyBrainEvent(finished, { ...secondFinish, outcome: 'failed' })
  ).toBe(finished);
});

test('an unknown effect blocks automatic retry and successful closure across attempts', () => {
  const running = applyBrainEvent(queued, firstStart);
  const effectReceipts = [committedEffect, unknownEffect];

  expect(applyBrainEvent(running, { ...firstFinish, effectReceipts })).toEqual({
    kind: 'finished',
    job: queued.job,
    attempt: firstFinish.attempt,
    outcome: 'unknown_outcome',
    usage: { kind: 'unknown_cut' },
  });

  const retry = applyBrainEvent(running, firstFinish);
  const resumed = applyBrainEvent(retry, secondStart);
  const finish = { ...secondFinish, effectReceipts };
  const blocked = applyBrainEvent(resumed, finish);

  expect(blocked).toEqual({
    kind: 'finished',
    job: queued.job,
    attempt: secondFinish.attempt,
    outcome: 'unknown_outcome',
    usage: { kind: 'reported', inputTokens: 24, outputTokens: 0 },
  });
  expect(applyBrainEvent(blocked, secondFinish)).toBe(blocked);
  expect(
    applyBrainEvent(resumed, {
      ...secondFinish,
      effectReceipts: [committedEffect],
    })
  ).toMatchObject({ kind: 'finished', outcome: 'succeeded' });
});

test('a cut stream keeps terminal usage unknown', () => {
  const running = applyBrainEvent(queued, firstStart);

  expect(
    applyBrainEvent(running, { ...firstFinish, outcome: 'timed_out' })
  ).toEqual({
    kind: 'finished',
    job: queued.job,
    attempt: firstFinish.attempt,
    outcome: 'timed_out',
    usage: { kind: 'unknown_cut' },
  });
});

test('effect redelivery distinguishes an unknown outcome from confirmed completion', () => {
  expect(effectReplay(unknownEffect)).toBe('unknown_outcome_blocked');
  expect(effectReplay(committedEffect)).toBe('already_committed');
});
