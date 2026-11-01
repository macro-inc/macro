import { createQueryKeys } from '@lukemorales/query-key-factory';

export const sequenceKeys = createQueryKeys('sequences', {
  list: null,
  detail: (sequenceId: string) => ({ queryKey: [sequenceId] }),
  enrollment: (enrollmentId: string) => ({ queryKey: [enrollmentId] }),
  contact: (crmContactId: string) => ({ queryKey: [crmContactId] }),
});

/** Enrollment actions in flight, so each row can tell its own request is running. */
export const ENROLLMENT_ACTION_MUTATION_KEY = [
  ...sequenceKeys._def,
  'enrollmentAction',
] as const;
