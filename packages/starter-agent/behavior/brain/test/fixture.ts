import type {
  BrainAttempt,
  BrainEvent,
  BrainJobState,
  EffectReceipt,
} from '../contracts.ts';

export const queued = {
  kind: 'queued',
  job: {
    jobId: 'job-1',
    deadlineAt: '2026-01-01T00:05:00Z',
    prompt: {
      constitution: {
        repoHeadSha: '0123456789abcdef0123456789abcdef01234567',
        charterSha256:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
      taskPack: { id: 'fixture', revision: '1' },
    },
  },
} as const satisfies BrainJobState;

const firstAttempt = {
  jobId: queued.job.jobId,
  attemptId: 'attempt-1',
  leaseEpoch: 1,
} satisfies BrainAttempt;

const secondAttempt = {
  jobId: queued.job.jobId,
  attemptId: 'attempt-2',
  leaseEpoch: 2,
} satisfies BrainAttempt;

export const firstStart = {
  kind: 'attempt_started',
  attempt: firstAttempt,
} as const satisfies BrainEvent;

export const firstFinish = {
  kind: 'attempt_finished',
  attempt: firstAttempt,
  outcome: 'retryable',
  usage: { kind: 'unknown_cut' },
  effectReceipts: [],
} as const satisfies BrainEvent;

export const secondStart = {
  kind: 'attempt_started',
  attempt: secondAttempt,
} as const satisfies BrainEvent;

export const secondFinish = {
  kind: 'attempt_finished',
  attempt: secondAttempt,
  outcome: 'succeeded',
  usage: { kind: 'reported', inputTokens: 24, outputTokens: 0 },
  effectReceipts: [],
} as const satisfies BrainEvent;

export const unknownEffect = {
  attempt: firstAttempt,
  actionId: 'action-1',
  status: 'unknown_outcome',
} as const satisfies EffectReceipt;

export const committedEffect = {
  attempt: firstAttempt,
  actionId: 'action-2',
  status: 'committed',
  externalRef: 'record-1',
} as const satisfies EffectReceipt;
