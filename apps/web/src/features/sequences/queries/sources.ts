import { queryReadyGate } from '@queries/gate';
import { useQuery } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type {
  ContactEnrollmentsSource,
  Enroller,
  EnrollmentCommands,
  EnrollmentSource,
  SequenceListSource,
  SequenceSource,
} from '../context/sequences-context';
import {
  contactEnrollmentsQueryOptions,
  enrollmentQueryOptions,
  sequenceQueryOptions,
  sequencesQueryOptions,
  toSequenceFailure,
  useCreateSequenceMutation,
  useDeleteSequenceMutation,
  useEnrollMutation,
  useEnrollmentActionMutation,
  useEnrollmentActionsInFlight,
  useUpdateSequenceMutation,
} from './sequences';

async function outcome<T>(request: Promise<T>) {
  return await ResultAsync.fromPromise(request, toSequenceFailure);
}

export function createSequenceList(): SequenceListSource {
  const query = useQuery(() => sequencesQueryOptions());
  const create = useCreateSequenceMutation();
  return {
    // Gated reads keep cached rows through a failed refetch (FE-48).
    sequences: () => (queryReadyGate(query) ? query.data : []),
    pending: () => query.isPending,
    failure: () =>
      query.isError && !queryReadyGate(query)
        ? toSequenceFailure(query.error)
        : undefined,
    refresh: () => query.refetch(),
    create: (input) => outcome(create.mutateAsync(input)),
    creating: () => create.isPending,
  };
}

export function createSequence(sequenceId: Accessor<string>): SequenceSource {
  const query = useQuery(() => sequenceQueryOptions(sequenceId()));
  const update = useUpdateSequenceMutation();
  const remove = useDeleteSequenceMutation();
  const loaded = () => (queryReadyGate(query) ? query.data : undefined);
  return {
    sequence: () => loaded()?.sequence,
    enrollments: () => loaded()?.enrollments ?? [],
    pending: () => query.isPending,
    failure: () =>
      query.isError && !loaded() ? toSequenceFailure(query.error) : undefined,
    refresh: () => query.refetch(),
    update: (request) =>
      outcome(update.mutateAsync({ sequenceId: sequenceId(), request })),
    updating: () => update.isPending,
    remove: () => outcome(remove.mutateAsync(sequenceId())),
    removing: () => remove.isPending,
  };
}

export function createEnrollment(
  enrollmentId: Accessor<string>
): EnrollmentSource {
  const query = useQuery(() => enrollmentQueryOptions(enrollmentId()));
  return {
    detail: () => (queryReadyGate(query) ? query.data : undefined),
    pending: () => query.isPending,
    failed: () => query.isError && !queryReadyGate(query),
    refresh: () => query.refetch(),
  };
}

export function createEnrollmentCommands(
  sequenceId: Accessor<string>
): EnrollmentCommands {
  const mutation = useEnrollmentActionMutation();
  const inFlight = useEnrollmentActionsInFlight();
  return {
    run: (enrollment, action) =>
      outcome(
        mutation.mutateAsync({ sequenceId: sequenceId(), enrollment, action })
      ),
    pending: (enrollmentId) => inFlight().includes(enrollmentId),
  };
}

export function createEnroller(): Enroller {
  const mutation = useEnrollMutation();
  return {
    enroll: (sequenceId, request) =>
      outcome(mutation.mutateAsync({ sequenceId, request })),
    pending: () => mutation.isPending,
  };
}

export function createContactEnrollments(
  crmContactId: Accessor<string>
): ContactEnrollmentsSource {
  const query = useQuery(() => contactEnrollmentsQueryOptions(crmContactId()));
  return {
    enrollments: () => (queryReadyGate(query) ? query.data : []),
    pending: () => query.isPending,
    failure: () =>
      query.isError && !queryReadyGate(query)
        ? toSequenceFailure(query.error)
        : undefined,
    refresh: () => query.refetch(),
  };
}
