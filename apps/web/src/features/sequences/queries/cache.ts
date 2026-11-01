import type {
  EnrollmentAction,
  EnrollmentDetail,
  EnrollmentSummary,
  Sequence,
  SequenceDetailResponse,
  SequenceStatus,
  SequenceSummary,
} from '@service-email/generated/schemas';
import { match } from 'ts-pattern';

const NO_COUNTS: SequenceSummary['counts'] = {
  active: 0,
  paused: 0,
  needsAttention: 0,
  stopped: 0,
  completed: 0,
};

/** The list with a saved sequence's row, keeping the counts it already has. */
export function withSummary(
  list: SequenceSummary[] | undefined,
  sequence: Sequence
): SequenceSummary[] | undefined {
  if (!list) return list;
  const previous = list.find((item) => item.id === sequence.id);
  const summary: SequenceSummary = {
    id: sequence.id,
    name: sequence.name,
    status: sequence.status,
    stepCount: sequence.steps.length,
    counts: previous?.counts ?? NO_COUNTS,
    updatedAt: sequence.updatedAt,
  };
  return previous
    ? list.map((item) => (item.id === sequence.id ? summary : item))
    : [summary, ...list];
}

export function withoutSummary(
  list: SequenceSummary[] | undefined,
  sequenceId: string
) {
  return list?.filter((item) => item.id !== sequenceId);
}

/** A status toggled ahead of the server; the version stays the one it saw. */
export function withListStatus(
  list: SequenceSummary[] | undefined,
  sequenceId: string,
  status: SequenceStatus
) {
  return list?.map((item) =>
    item.id === sequenceId ? { ...item, status } : item
  );
}

export function withDetailStatus(
  detail: SequenceDetailResponse | undefined,
  status: SequenceStatus
): SequenceDetailResponse | undefined {
  return detail && { ...detail, sequence: { ...detail.sequence, status } };
}

export function withSequence(
  detail: SequenceDetailResponse | undefined,
  sequence: Sequence
): SequenceDetailResponse | undefined {
  return detail && { ...detail, sequence };
}

/** The detail with one enrollment replaced in place. */
export function withEnrollment(
  detail: SequenceDetailResponse | undefined,
  enrollment: EnrollmentSummary
): SequenceDetailResponse | undefined {
  return (
    detail && {
      ...detail,
      enrollments: detail.enrollments.map((item) =>
        item.id === enrollment.id ? enrollment : item
      ),
    }
  );
}

/** An enrollment's frozen steps with its newer summary fields. */
export function withEnrollmentSummary(
  detail: EnrollmentDetail | undefined,
  summary: EnrollmentSummary
): EnrollmentDetail | undefined {
  return detail && { ...detail, ...summary };
}

/**
 * The state an action leaves, as the server will report it; `undefined` for
 * one whose outcome only the server knows (an opt-out reaches other rows).
 */
export function expectedState(
  action: EnrollmentAction
): Pick<EnrollmentSummary, 'status' | 'reason'> | undefined {
  return match(action)
    .with('pause', () => ({ status: 'paused' as const, reason: null }))
    .with('resume', () => ({ status: 'active' as const, reason: null }))
    .with('stop', () => ({
      status: 'stopped' as const,
      reason: 'manual' as const,
    }))
    .with('unsubscribe', () => undefined)
    .exhaustive(() => undefined);
}
