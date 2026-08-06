import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';

export const emailKeys = createQueryKeys('email', {
  all: null,
  labels: null,
  links: null,
  linksHealthProbe: null,
  backfillJobs: null,
  threads: null,
  thread: (threadId: string) => ({
    queryKey: [threadId],
  }),
  threadMessages: (threadId: string) => ({
    // Versioned so pages fetched through REST are never reused as GraphQL data.
    queryKey: ['messages', 'graphql-v1', threadId],
  }),
  previews: (params: {
    view: PreviewViewStandardLabel;
    limit?: number;
    sort_method?: string;
  }) => ({
    queryKey: [{ infinite: true, ...params }],
  }),
});
