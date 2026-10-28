import { createQueryKeys } from '@lukemorales/query-key-factory';

export const slackImportKeys = createQueryKeys('slack-import', {
  list: (teamId: string, before?: string) => [teamId, before ?? ''],
  job: (teamId: string, jobId: string) => [teamId, jobId],
});
