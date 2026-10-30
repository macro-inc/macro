import { createQueryKeys } from '@lukemorales/query-key-factory';

export const marketingKeys = createQueryKeys('emailMarketing', {
  snapshot: (userId: string | undefined) => ({
    queryKey: [userId ?? 'signed-out'],
  }),
  /** Delivery problems for a set of enrollments, keyed by their versions. */
  attention: (userId: string | undefined, versions: string[]) => ({
    queryKey: [userId ?? 'signed-out', ...versions],
  }),
});
