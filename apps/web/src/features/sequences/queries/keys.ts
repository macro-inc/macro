import { createQueryKeys } from '@lukemorales/query-key-factory';

export const sequenceKeys = createQueryKeys('sequences', {
  list: null,
  detail: (sequenceId: string) => ({ queryKey: [sequenceId] }),
  enrollment: (enrollmentId: string) => ({ queryKey: [enrollmentId] }),
  contact: (crmContactId: string) => ({ queryKey: [crmContactId] }),
  people: (search: string) => ({ queryKey: [search] }),
});
