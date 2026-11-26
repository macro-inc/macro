import type { LogTimeOptions, Macro, TimeEntry } from '@macro-inc/sdk';
import {
  type BrainAttempt,
  type BrainJob,
  type EffectReceipt,
  effectReplay,
} from './contracts.ts';

type TaskTimeInput = Readonly<
  Required<Pick<LogTimeOptions, 'date' | 'minutes'>>
>;

/** Approved by the parent at admission and kept unchanged across attempts. */
export type TaskTimeGrant = TaskTimeInput & {
  readonly jobId: BrainJob['jobId'];
  readonly action: 'task.logTime';
  /** A unique parent-issued UUIDv7, also the downstream client entry ID. */
  readonly actionId: string;
  readonly tenantId: ReturnType<Macro['teams']['byId']>['id'];
  /** The teammate's authenticated Macro user ID (Starter's config.me). */
  readonly actorId: ReturnType<Macro['users']['byId']>['id'];
  readonly taskId: ReturnType<Macro['tasks']['byId']>['id'];
};

type TimeEntryConfirmation = Pick<
  TaskTimeGrant,
  'actorId' | 'taskId' | 'date' | 'minutes'
> & { readonly id: TimeEntry['id'] };

type LogTaskTime = (
  input: TaskTimeInput & { readonly idempotencyKey: string }
) => Promise<TimeEntryConfirmation>;

type DispatchResult =
  | 'outside_grant'
  | 'inactive_attempt'
  | 'denied'
  | 'committed'
  | ReturnType<typeof effectReplay>;

const uuidV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const matchesGrant = (request: unknown, grant: TaskTimeGrant): boolean => {
  if (typeof request !== 'object' || request === null) return false;

  const { action, taskId, date, minutes } = grant;
  const expected = Object.entries({ action, taskId, date, minutes });
  return (
    Reflect.ownKeys(request).length === expected.length &&
    expected.every(
      ([key, value]) =>
        Object.hasOwn(request, key) && Reflect.get(request, key) === value
    )
  );
};

/** One process-local parent boundary per admitted action, shared across attempts. */
export const taskTimeEffect = ({
  job,
  grant: approved,
  currentAttempt,
  now,
  authorize,
}: {
  readonly job: BrainJob;
  readonly grant: TaskTimeGrant;
  /** The parent's live lease, absent on cancellation, finish or loss of ownership. */
  readonly currentAttempt: () => BrainAttempt | undefined;
  readonly now: () => number;
  /**
   * Check current tenant, authenticated teammate, explicit approval, task Edit
   * and rollout. Return a writer bound to that actor and exact task. The write
   * itself must go through the authenticated task-time operation, which checks
   * Edit and rollout again. Failure to establish authorization grants nothing.
   */
  readonly authorize: (
    grant: TaskTimeGrant
  ) => Promise<LogTaskTime | undefined>;
}) => {
  const { jobId, deadlineAt } = job;
  const grant = Object.freeze({ ...approved });
  if (
    grant.jobId !== jobId ||
    grant.action !== 'task.logTime' ||
    !uuidV7.test(grant.actionId)
  )
    throw new Error('invalid task-time grant');

  const deadline = Date.parse(deadlineAt);
  let receipt: EffectReceipt | undefined;

  const isCurrent = (attempt: BrainAttempt): boolean => {
    const current = currentAttempt();
    return (
      current !== undefined &&
      now() < deadline &&
      Number.isSafeInteger(attempt.leaseEpoch) &&
      attempt.leaseEpoch > 0 &&
      attempt.jobId === jobId &&
      attempt.jobId === current.jobId &&
      attempt.attemptId === current.attemptId &&
      attempt.leaseEpoch === current.leaseEpoch
    );
  };

  // Keep the lease check and compare-and-set in one synchronous parent turn.
  const compareAndSet = (
    expected: EffectReceipt | undefined,
    next: EffectReceipt
  ): boolean => {
    if (!isCurrent(next.attempt) || receipt !== expected) return false;
    receipt = Object.freeze(next);
    return true;
  };

  /** The parent supplies the transport's attempt; only request comes from the tool. */
  const dispatch = async (
    lease: BrainAttempt,
    request: unknown
  ): Promise<DispatchResult> => {
    const attempt = Object.freeze({ ...lease });
    if (!isCurrent(attempt)) return 'inactive_attempt';
    if (!matchesGrant(request, grant)) return 'outside_grant';

    let write: LogTaskTime | undefined;
    try {
      write = await authorize(grant);
    } catch {
      return 'denied';
    }
    if (!isCurrent(attempt)) return 'inactive_attempt';
    if (write === undefined) return 'denied';
    if (receipt !== undefined) return effectReplay(receipt);

    // Record uncertainty before the send. There is no read-before-resend path:
    // a missing or deleted row cannot establish that a previous send failed.
    const pending = {
      attempt,
      actionId: grant.actionId,
      status: 'unknown_outcome',
    } satisfies EffectReceipt;
    if (!compareAndSet(undefined, pending)) return 'inactive_attempt';

    let confirmed: TimeEntryConfirmation;
    try {
      confirmed = await write({
        idempotencyKey: grant.actionId,
        date: grant.date,
        minutes: grant.minutes,
      });
    } catch {
      return 'unknown_outcome_blocked';
    }

    if (
      confirmed.id !== grant.actionId ||
      confirmed.actorId !== grant.actorId ||
      confirmed.taskId !== grant.taskId ||
      confirmed.date !== grant.date ||
      confirmed.minutes !== grant.minutes
    )
      return 'unknown_outcome_blocked';

    return compareAndSet(pending, {
      ...pending,
      status: 'committed',
      externalRef: confirmed.id,
    })
      ? 'committed'
      : 'unknown_outcome_blocked';
  };

  // The parent reads this for attempt completion after draining active dispatches.
  return { dispatch, receipt: () => receipt };
};
