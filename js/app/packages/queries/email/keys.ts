import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';

export const emailKeys = createQueryKeys('email', {
  all: null,
  links: null,
  threads: null,
  thread: (threadId: string) => ({
    queryKey: [threadId],
  }),
  threadMessages: (threadId: string) => ({
    queryKey: ['messages', threadId],
  }),
  previews: (params: {
    view: PreviewViewStandardLabel;
    limit?: number;
    sort_method?: string;
  }) => ({
    queryKey: [{ infinite: true, ...params }],
  }),
});
