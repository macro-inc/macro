import {
  type ResultError,
  ThrownResultError,
  thrownResultErrorHasCode,
  throwOnErr,
} from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient, type SequenceRequestError } from '@service-email/client';
import {
  type EnrollmentAction,
  type EnrollmentDetail,
  type EnrollmentSummary,
  type EnrollRequest,
  type EnrollResult,
  type Sequence,
  type SequenceDetailResponse,
  SequenceErrorCode,
  type SequenceInput,
  type SequenceStatus,
  type SequenceSummary,
  type UpdateSequenceRequest,
} from '@service-email/generated/schemas';
import {
  type Mutation,
  queryOptions,
  useMutation,
  useMutationState,
} from '@tanstack/solid-query';
import { isRetryable, type SequenceFailure } from '../core/errors';
import {
  enrollmentSnapshot,
  expectedState,
  withDetailStatus,
  withEnrollment,
  withEnrollmentSummary,
  withListStatus,
  withoutSummary,
  withSequence,
  withSummary,
} from './cache';
import { ENROLLMENT_ACTION_MUTATION_KEY, sequenceKeys } from './keys';

/** Steps send on the server; an open sequence follows them about once a minute. */
const PROGRESS_INTERVAL = 60_000;

function isRefusal(error: ResultError): error is SequenceRequestError {
  return error.code in SequenceErrorCode;
}

/** A failed request as the feature reads it: the server's refusal, or no answer. */
export function toSequenceFailure(error: unknown): SequenceFailure {
  const refusal =
    error instanceof ThrownResultError
      ? error.errors.find(isRefusal)
      : undefined;
  if (!refusal) return { kind: 'unavailable' };
  return {
    kind: 'refused',
    code: refusal.code,
    problem: refusal.problem ?? undefined,
    position: refusal.position ?? undefined,
    tokens: refusal.tokens,
  };
}

/** Reads retry once, and never on a refusal or a lost session. */
function retrySequenceRead(failureCount: number, error: Error) {
  return (
    failureCount < 1 &&
    !thrownResultErrorHasCode(error, 'UNAUTHORIZED') &&
    isRetryable(toSequenceFailure(error))
  );
}

/** Reads the owner's views also refresh whenever the window regains focus. */
const SEQUENCE_READ_OPTIONS = {
  retry: retrySequenceRead,
  refetchOnWindowFocus: 'always',
} as const;

/** The part of a query a polling policy reads. */
type Polled<T> = { state: { data?: T } };

/** A draft has no enrollments yet, so it has no progress to follow. */
export function sequenceRefetchInterval({
  state,
}: Polled<SequenceDetailResponse>) {
  return state.data?.sequence.status === 'draft' ? false : PROGRESS_INTERVAL;
}

/**
 * An enrollment moves on its own only while it sends or needs attention, or
 * while a step it scheduled is still out.
 */
export function enrollmentRefetchInterval({ state }: Polled<EnrollmentDetail>) {
  const enrollment = state.data;
  const settled =
    !!enrollment &&
    enrollment.status !== 'active' &&
    enrollment.status !== 'needs_attention' &&
    !enrollment.steps.some((step) => step.status === 'scheduled');
  return settled ? false : PROGRESS_INTERVAL;
}

async function fetchSequences() {
  const { sequences } = await throwOnErr(() => emailClient.listSequences());
  return sequences;
}

export function sequencesQueryOptions() {
  return queryOptions({
    queryKey: sequenceKeys.list.queryKey,
    queryFn: fetchSequences,
    reconcile: 'id',
    ...SEQUENCE_READ_OPTIONS,
  });
}

export function sequenceQueryOptions(sequenceId: string) {
  return queryOptions({
    queryKey: sequenceKeys.detail(sequenceId).queryKey,
    queryFn: () => throwOnErr(() => emailClient.getSequence(sequenceId)),
    // It polls under open rows and the editor; keep row identity across refetches.
    reconcile: 'id',
    ...SEQUENCE_READ_OPTIONS,
    refetchInterval: sequenceRefetchInterval,
  });
}

export function enrollmentQueryOptions(enrollmentId: string) {
  return queryOptions({
    queryKey: sequenceKeys.enrollment(enrollmentId).queryKey,
    queryFn: () => throwOnErr(() => emailClient.getEnrollment(enrollmentId)),
    retry: retrySequenceRead,
    refetchInterval: enrollmentRefetchInterval,
  });
}

async function fetchContactEnrollments(crmContactId: string) {
  const { enrollments } = await throwOnErr(() =>
    emailClient.contactEnrollments(crmContactId)
  );
  return enrollments;
}

export function contactEnrollmentsQueryOptions(crmContactId: string) {
  return queryOptions({
    queryKey: sequenceKeys.contact(crmContactId).queryKey,
    queryFn: () => fetchContactEnrollments(crmContactId),
    // A contact is in a sequence once, so rows keep their identity by it.
    reconcile: 'sequenceId',
    ...SEQUENCE_READ_OPTIONS,
  });
}

function setList(
  update: (list: SequenceSummary[] | undefined) => SequenceSummary[] | undefined
) {
  queryClient.setQueryData<SequenceSummary[]>(
    sequenceKeys.list.queryKey,
    update
  );
}

function setDetail(
  sequenceId: string,
  update: (
    detail: SequenceDetailResponse | undefined
  ) => SequenceDetailResponse | undefined
) {
  queryClient.setQueryData<SequenceDetailResponse>(
    sequenceKeys.detail(sequenceId).queryKey,
    update
  );
}

function invalidateList() {
  return queryClient.invalidateQueries({
    queryKey: sequenceKeys.list.queryKey,
  });
}

function invalidateDetail(sequenceId: string) {
  return queryClient.invalidateQueries({
    queryKey: sequenceKeys.detail(sequenceId).queryKey,
  });
}

function invalidateContactCards() {
  return queryClient.invalidateQueries({
    queryKey: sequenceKeys.contact._def,
  });
}

export function useCreateSequenceMutation() {
  return useMutation<Sequence, Error, SequenceInput>(() => ({
    mutationFn: (input) => throwOnErr(() => emailClient.createSequence(input)),
    onSuccess: (sequence) => {
      queryClient.setQueryData<SequenceDetailResponse>(
        sequenceKeys.detail(sequence.id).queryKey,
        { sequence, enrollments: [] }
      );
      setList((list) => withSummary(list, sequence));
    },
    onSettled: invalidateList,
  }));
}

type SequenceUpdate = { sequenceId: string; request: UpdateSequenceRequest };
type StatusRollback = { status: SequenceStatus } | undefined;

/** Status changes show at once and roll back alone; edits wait for the server. */
export function useUpdateSequenceMutation() {
  return useMutation<Sequence, Error, SequenceUpdate, StatusRollback>(() => ({
    mutationFn: ({ sequenceId, request }) =>
      throwOnErr(() => emailClient.updateSequence(sequenceId, request)),
    onMutate: async ({ sequenceId, request }) => {
      const { status } = request;
      if (!status) return;
      const detailKey = sequenceKeys.detail(sequenceId).queryKey;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: sequenceKeys.list.queryKey }),
      ]);
      const previous =
        queryClient.getQueryData<SequenceDetailResponse>(detailKey)?.sequence
          .status ??
        queryClient
          .getQueryData<SequenceSummary[]>(sequenceKeys.list.queryKey)
          ?.find((item) => item.id === sequenceId)?.status;
      setDetail(sequenceId, (detail) => withDetailStatus(detail, status));
      setList((list) => withListStatus(list, sequenceId, status));
      return previous && { status: previous };
    },
    onError: (_error, { sequenceId }, rollback) => {
      if (!rollback) return;
      setDetail(sequenceId, (detail) =>
        withDetailStatus(detail, rollback.status)
      );
      setList((list) => withListStatus(list, sequenceId, rollback.status));
    },
    onSuccess: (sequence) => {
      setDetail(sequence.id, (detail) => withSequence(detail, sequence));
      setList((list) => withSummary(list, sequence));
    },
    onSettled: (_data, _error, { sequenceId, request }) =>
      Promise.all([
        invalidateDetail(sequenceId),
        invalidateList(),
        // Contact cards show whether the sequence is paused.
        request.status ? invalidateContactCards() : undefined,
      ]),
  }));
}

export function useDeleteSequenceMutation() {
  return useMutation<void, Error, string>(() => ({
    mutationFn: async (sequenceId) => {
      await throwOnErr(() => emailClient.deleteSequence(sequenceId));
    },
    onSuccess: (_data, sequenceId) => {
      setList((list) => withoutSummary(list, sequenceId));
      queryClient.removeQueries({
        queryKey: sequenceKeys.detail(sequenceId).queryKey,
      });
    },
    onSettled: () => Promise.all([invalidateList(), invalidateContactCards()]),
  }));
}

type Enrollment = { sequenceId: string; request: EnrollRequest };

export function useEnrollMutation() {
  return useMutation<EnrollResult[], Error, Enrollment>(() => ({
    mutationFn: async ({ sequenceId, request }) => {
      const { results } = await throwOnErr(() =>
        emailClient.enrollContacts(sequenceId, request)
      );
      return results;
    },
    onSettled: (_data, _error, { sequenceId, request }) =>
      Promise.all([
        invalidateDetail(sequenceId),
        invalidateList(),
        ...request.crmContactIds.map((id) =>
          queryClient.invalidateQueries({
            queryKey: sequenceKeys.contact(id).queryKey,
          })
        ),
      ]),
  }));
}

type EnrollmentChange = {
  sequenceId: string;
  enrollment: Pick<EnrollmentSummary, 'id' | 'crmContactId'>;
  action: EnrollmentAction;
};
type EnrollmentRollback = { previous: EnrollmentSummary } | undefined;

function setEnrollment(sequenceId: string, enrollment: EnrollmentSummary) {
  setDetail(sequenceId, (detail) => withEnrollment(detail, enrollment));
  queryClient.setQueryData<EnrollmentDetail>(
    sequenceKeys.enrollment(enrollment.id).queryKey,
    (detail) => withEnrollmentSummary(detail, enrollment)
  );
}

/**
 * Pause, resume and stop show at once and roll back on failure. An opt-out
 * is team-wide, so it waits for the server and refreshes every sequence.
 */
export function useEnrollmentActionMutation() {
  return useMutation<
    EnrollmentSummary,
    Error,
    EnrollmentChange,
    EnrollmentRollback
  >(() => ({
    mutationKey: ENROLLMENT_ACTION_MUTATION_KEY,
    mutationFn: ({ enrollment, action }) =>
      throwOnErr(() => emailClient.updateEnrollment(enrollment.id, { action })),
    onMutate: async ({ sequenceId, enrollment, action }) => {
      const expected = expectedState(action);
      if (!expected) return;
      const detailKey = sequenceKeys.detail(sequenceId).queryKey;
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({
          queryKey: sequenceKeys.enrollment(enrollment.id).queryKey,
        }),
      ]);
      const previous = enrollmentSnapshot(
        queryClient.getQueryData<SequenceDetailResponse>(detailKey),
        enrollment.id
      );
      if (!previous) return;
      setEnrollment(sequenceId, { ...previous, ...expected });
      return { previous };
    },
    onError: (_error, { sequenceId }, rollback) => {
      if (rollback) setEnrollment(sequenceId, rollback.previous);
    },
    onSuccess: (enrollment, { sequenceId }) =>
      setEnrollment(sequenceId, enrollment),
    onSettled: (_data, _error, { sequenceId, enrollment, action }) =>
      Promise.all([
        action === 'unsubscribe'
          ? queryClient.invalidateQueries({
              queryKey: sequenceKeys.detail._def,
            })
          : invalidateDetail(sequenceId),
        queryClient.invalidateQueries({
          queryKey: sequenceKeys.enrollment(enrollment.id).queryKey,
        }),
        invalidateList(),
        action === 'unsubscribe'
          ? invalidateContactCards()
          : enrollment.crmContactId
            ? queryClient.invalidateQueries({
                queryKey: sequenceKeys.contact(enrollment.crmContactId)
                  .queryKey,
              })
            : undefined,
      ]),
  }));
}

/** The enrollment an action is for: every mutation under its key changes one. */
function actionEnrollmentId({ state }: Mutation) {
  return (state.variables as EnrollmentChange | undefined)?.enrollment.id;
}

/**
 * Enrollments with an action still in flight. One mutation runs every row's
 * actions, and it only follows the newest; the cache still holds each one.
 */
export function useEnrollmentActionsInFlight() {
  return useMutationState(
    () => ({
      filters: {
        mutationKey: ENROLLMENT_ACTION_MUTATION_KEY,
        status: 'pending',
      },
      select: actionEnrollmentId,
    }),
    () => queryClient
  );
}
