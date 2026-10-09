import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { PreviewViewStandardLabel } from '@service-email/generated/schemas';

export const emailKeys = createQueryKeys('email', {
  all: null,
  settingsOperations: (linkId: string) => ({ queryKey: [linkId] }),
  threadOperations: (threadId: string) => ({ queryKey: [threadId] }),
  messageOperation: (messageId: string) => ({ queryKey: [messageId] }),
  labels: null,
  links: null,
  linksHealthProbe: null,
  backfillJobs: null,
  threads: null,
  thread: (threadId: string) => ({
    queryKey: [threadId],
  }),
  threadMessages: (threadId: string) => ({
    queryKey: ['messages', threadId],
  }),
  composeDraftState: (params: {
    draftId: string;
    threadId: string;
    inboxId?: string;
  }) => ({
    queryKey: ['compose-draft-state', params],
  }),
  scheduledMessages: (linkIds: string[]) => ({
    queryKey: [{ linkIds }],
  }),
  previews: (params: {
    view: PreviewViewStandardLabel;
    limit?: number;
    sort_method?: string;
  }) => ({
    queryKey: [{ infinite: true, ...params }],
  }),
});
