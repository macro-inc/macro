/** Revisions fixed at job admission and carried through every attempt. */
export type PromptPins = {
  readonly constitution: {
    readonly repoHeadSha: string;
    readonly charterSha256: string;
  };
  readonly taskPack: {
    readonly id: string;
    readonly revision: string;
  };
};

export type BrainJob = {
  readonly jobId: string;
  /** Absolute deadline in ISO 8601 UTC, shared by every attempt. */
  readonly deadlineAt: string;
  readonly prompt: PromptPins;
};

export type BrainAttempt = {
  readonly jobId: BrainJob['jobId'];
  readonly attemptId: string;
  /** Positive, increasing fence within this job. */
  readonly leaseEpoch: number;
};

type AttemptUsage =
  | {
      readonly kind: 'reported';
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | { readonly kind: 'unknown_cut' };

type JobOutcome = 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export type BrainEvent =
  | { readonly kind: 'attempt_started'; readonly attempt: BrainAttempt }
  | {
      readonly kind: 'attempt_finished';
      readonly attempt: BrainAttempt;
      readonly outcome: JobOutcome | 'retryable';
      readonly usage: AttemptUsage;
      /** The job's current receipts across attempts, captured at completion for deterministic replay. */
      readonly effectReceipts: readonly EffectReceipt[];
    };

export type BrainJobState = { readonly job: BrainJob } & (
  | {
      readonly kind: 'queued';
      /** Last attempt's fence, retained across retry. */
      readonly previousAttempt?: BrainAttempt;
    }
  | { readonly kind: 'running'; readonly attempt: BrainAttempt }
  | {
      readonly kind: 'finished';
      readonly attempt: BrainAttempt;
      readonly outcome: JobOutcome | 'unknown_outcome';
      readonly usage: AttemptUsage;
    }
);

/** Fold an ordered job event. Ignore redelivery, stale starts, and finishes from attempts that do not own the job. */
export const applyBrainEvent = (
  state: BrainJobState,
  event: BrainEvent
): BrainJobState => {
  const { job } = state;
  const { attempt } = event;
  if (job.jobId !== attempt.jobId || state.kind === 'finished') return state;

  if (event.kind === 'attempt_started') {
    if (
      state.kind !== 'queued' ||
      !Number.isSafeInteger(attempt.leaseEpoch) ||
      attempt.leaseEpoch <= (state.previousAttempt?.leaseEpoch ?? 0) ||
      attempt.attemptId === state.previousAttempt?.attemptId
    )
      return state;

    return { job, kind: 'running', attempt };
  }

  if (
    state.kind !== 'running' ||
    attempt.attemptId !== state.attempt.attemptId ||
    attempt.leaseEpoch !== state.attempt.leaseEpoch
  )
    return state;

  const { outcome, usage, effectReceipts } = event;
  if (
    (outcome === 'succeeded' || outcome === 'retryable') &&
    effectReceipts.some(
      (receipt) =>
        receipt.attempt.jobId === job.jobId &&
        receipt.status === 'unknown_outcome'
    )
  )
    return {
      job,
      kind: 'finished',
      attempt,
      outcome: 'unknown_outcome',
      usage,
    };

  if (outcome === 'retryable')
    return { job, kind: 'queued', previousAttempt: attempt };

  return { job, kind: 'finished', attempt, outcome, usage };
};

/** A recorded effect is keyed by job and action across all attempts. */
export type EffectReceipt = {
  readonly attempt: BrainAttempt;
  /** Stable within the job and independent of any provider's tool call ID. */
  readonly actionId: string;
} & (
  | { readonly status: 'committed'; readonly externalRef: string }
  | { readonly status: 'unknown_outcome' }
);

/** Given the receipt for the same job and action, explain why replay is blocked. */
export const effectReplay = (
  receipt: EffectReceipt
): 'already_committed' | 'unknown_outcome_blocked' =>
  receipt.status === 'committed'
    ? 'already_committed'
    : 'unknown_outcome_blocked';
