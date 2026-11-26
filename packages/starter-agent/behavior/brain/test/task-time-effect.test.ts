import { expect, mock, test } from 'bun:test';
import { applyBrainEvent, type BrainAttempt } from '../contracts.ts';
import { type TaskTimeGrant, taskTimeEffect } from '../task-time-effect.ts';
import { firstFinish, firstStart, queued, secondStart } from './fixture.ts';

const actionId = '019b76da-a800-7000-8000-000000000001';
const request = {
  action: 'task.logTime',
  taskId: 'fixture-task',
  date: '2025-12-31',
  minutes: 15,
} as const;
const grant: TaskTimeGrant = {
  ...request,
  jobId: queued.job.jobId,
  tenantId: 'fixture-team',
  actorId: 'macro|teammate@example.com',
  actionId,
};
const confirmed = {
  id: actionId,
  actorId: grant.actorId,
  taskId: grant.taskId,
  date: grant.date,
  minutes: grant.minutes,
};

const first = firstStart.attempt;
const second = secondStart.attempt;
const fixture = (
  authorize: Parameters<typeof taskTimeEffect>[0]['authorize'],
  approved = { ...grant }
) => {
  let current: BrainAttempt | undefined = first;
  let time = Date.parse('2026-01-01T00:01:00Z');
  const boundary = taskTimeEffect({
    job: queued.job,
    grant: approved,
    authorize,
    currentAttempt: () => current,
    now: () => time,
  });

  return {
    ...boundary,
    setAttempt: (attempt: BrainAttempt | undefined) => {
      current = attempt;
    },
    expire: () => {
      time = Date.parse(queued.job.deadlineAt);
    },
  };
};

test('the parent accepts only the exact tool and input selected by its grant', async () => {
  const authorize = mock(async () => async () => confirmed);
  const approved = { ...grant };
  const parent = fixture(authorize, approved);
  approved.taskId = 'different-task';
  approved.minutes = 30;

  for (const call of [
    { ...request, action: 'task.startTimer' },
    { ...request, taskId: 'different-task' },
    { ...request, date: '2025-12-30' },
    { ...request, minutes: 30 },
    { ...request, actionId },
    { ...request, actorId: grant.actorId, tenantId: grant.tenantId },
    { ...request, note: 'extra input' },
    null,
    {},
  ]) {
    expect(await parent.dispatch(first, call)).toBe('outside_grant');
  }
  expect(authorize).not.toHaveBeenCalled();
  expect(parent.receipt()).toBeUndefined();
  expect(await parent.dispatch(first, request)).toBe('committed');
  expect(authorize).toHaveBeenCalledWith(grant);
});

test('a stable client UUID is required and the grant must belong to the job', () => {
  const authorize = async () => undefined;
  expect(() =>
    fixture(authorize, { ...grant, actionId: 'provider-call-1' })
  ).toThrow('invalid task-time grant');
  expect(() => fixture(authorize, { ...grant, jobId: 'foreign-job' })).toThrow(
    'invalid task-time grant'
  );
});

test('current identity, tenant, approval, Edit and rollout gate writes and receipt replay', async () => {
  const write = mock(async () => confirmed);
  const current = {
    tenantId: grant.tenantId,
    actorId: grant.actorId,
    approved: true,
    edit: true,
    rollout: true,
  };
  const authorize = mock(async (bound: TaskTimeGrant) =>
    current.tenantId === bound.tenantId &&
    current.actorId === bound.actorId &&
    current.approved &&
    current.edit &&
    current.rollout
      ? write
      : undefined
  );
  const parent = fixture(authorize);
  for (const revoked of [
    { tenantId: 'foreign-team' },
    { actorId: 'macro|other@example.com' },
    { approved: false },
    { edit: false },
    { rollout: false },
  ]) {
    const previous = { ...current };
    Object.assign(current, revoked);
    expect(await parent.dispatch(first, request)).toBe('denied');
    Object.assign(current, previous);
  }
  expect(parent.receipt()).toBeUndefined();
  expect(write).not.toHaveBeenCalled();

  parent.setAttempt(second);
  expect(await parent.dispatch(second, request)).toBe('committed');
  const receipt = parent.receipt();
  expect(receipt).toEqual({
    attempt: second,
    actionId,
    status: 'committed',
    externalRef: actionId,
  });
  expect(write).toHaveBeenCalledWith({
    idempotencyKey: actionId,
    date: request.date,
    minutes: request.minutes,
  });

  current.edit = false;
  expect(await parent.dispatch(second, request)).toBe('denied');
  current.edit = true;
  expect(await parent.dispatch(second, request)).toBe('already_committed');
  expect(parent.receipt()).toBe(receipt);
  expect(write).toHaveBeenCalledTimes(1);
});

test('a lease change during authorization fences the late grant', async () => {
  const authorization =
    Promise.withResolvers<() => Promise<typeof confirmed>>();
  const write = mock(async () => confirmed);
  const authorize = mock(() => authorization.promise);
  const parent = fixture(authorize);
  for (const stale of [
    { ...first, jobId: 'foreign-job' },
    { ...first, attemptId: 'other-attempt' },
    { ...first, leaseEpoch: 0 },
    { ...first, leaseEpoch: 2 },
  ]) {
    expect(await parent.dispatch(stale, request)).toBe('inactive_attempt');
  }
  expect(authorize).not.toHaveBeenCalled();

  const pending = parent.dispatch(first, request);
  expect(authorize).toHaveBeenCalledTimes(1);
  parent.setAttempt(second);
  authorization.resolve(write);
  expect(await pending).toBe('inactive_attempt');
  expect(write).not.toHaveBeenCalled();
  expect(parent.receipt()).toBeUndefined();
  expect(await parent.dispatch(second, request)).toBe('committed');
});

test('two concurrent, authorized duplicates share one claim and one send', async () => {
  const authorization =
    Promise.withResolvers<() => Promise<typeof confirmed>>();
  const sendStarted = Promise.withResolvers<void>();
  const response = Promise.withResolvers<typeof confirmed>();
  const write = mock(() => {
    sendStarted.resolve();
    return response.promise;
  });
  const authorize = mock(() => authorization.promise);
  const parent = fixture(authorize);
  const winner = parent.dispatch(first, request);
  const duplicate = parent.dispatch(first, request);
  expect(authorize).toHaveBeenCalledTimes(2);
  authorization.resolve(write);

  await sendStarted.promise;
  expect(await duplicate).toBe('unknown_outcome_blocked');
  expect(parent.receipt()).toEqual({
    attempt: first,
    actionId,
    status: 'unknown_outcome',
  });
  response.resolve(confirmed);
  expect(await winner).toBe('committed');
  const receipt = parent.receipt();
  expect(receipt).toEqual({
    attempt: first,
    actionId,
    status: 'committed',
    externalRef: actionId,
  });

  parent.setAttempt(second);
  expect(await parent.dispatch(second, request)).toBe('already_committed');
  expect(parent.receipt()).toBe(receipt);
  expect(write).toHaveBeenCalledTimes(1);
});

test('an uncertain send remains blocked after the external entry disappears', async () => {
  const entries = new Set<string>();
  const write = mock(async () => {
    entries.add(actionId);
    throw new Error('response lost after write');
  });
  const parent = fixture(async () => write);
  expect(await parent.dispatch(first, request)).toBe('unknown_outcome_blocked');
  expect(entries.delete(actionId)).toBe(true);
  const receipt = parent.receipt();
  if (receipt === undefined) throw new Error('expected an unknown receipt');
  expect(receipt.status).toBe('unknown_outcome');

  const running = applyBrainEvent(queued, firstStart);
  expect(
    applyBrainEvent(running, { ...firstFinish, effectReceipts: [receipt] })
  ).toMatchObject({ kind: 'finished', outcome: 'unknown_outcome' });

  parent.setAttempt(second);
  expect(await parent.dispatch(second, request)).toBe(
    'unknown_outcome_blocked'
  );
  expect(parent.receipt()).toBe(receipt);
  expect(entries.size).toBe(0);
  expect(write).toHaveBeenCalledTimes(1);
});

test('downstream confirmation must identify the same actor, task, input and action', async () => {
  for (const result of [
    { ...confirmed, id: 'other-entry' },
    { ...confirmed, actorId: 'macro|other@example.com' },
    { ...confirmed, taskId: 'different-task' },
    { ...confirmed, date: '2025-12-30' },
    { ...confirmed, minutes: 30 },
  ]) {
    const parent = fixture(async () => async () => result);
    expect(await parent.dispatch(first, request)).toBe(
      'unknown_outcome_blocked'
    );
    expect(parent.receipt()?.status).toBe('unknown_outcome');
  }
});

test.each(['new lease', 'cancellation', 'deadline'] as const)(
  'a response after %s cannot promote the owning attempt’s receipt',
  async (fence) => {
    const sendStarted = Promise.withResolvers<void>();
    const response = Promise.withResolvers<typeof confirmed>();
    const parent = fixture(async () => () => {
      sendStarted.resolve();
      return response.promise;
    });
    const pending = parent.dispatch(first, request);
    await sendStarted.promise;
    const receipt = parent.receipt();
    if (fence === 'deadline') parent.expire();
    else parent.setAttempt(fence === 'new lease' ? second : undefined);

    response.resolve(confirmed);
    expect(await pending).toBe('unknown_outcome_blocked');
    expect(parent.receipt()).toBe(receipt);
    expect(receipt?.status).toBe('unknown_outcome');
    expect(await parent.dispatch(first, request)).toBe('inactive_attempt');
  }
);
