import { createQueryKeys } from '@lukemorales/query-key-factory';
export const reviewKeys = createQueryKeys('agentReviews', {
  detail: (session: string, review: string) => ({
    queryKey: [session, review],
  }),
});
