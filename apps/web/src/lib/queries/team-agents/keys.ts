import { createQueryKeys } from '@lukemorales/query-key-factory';

export const teamAgentKeys = createQueryKeys('team-agents', {
  list: (teamId: string) => [teamId],
  voices: (teamId: string) => [teamId],
  voiceSample: (teamId: string, model: string) => [teamId, model],
  voice: (teamId: string, userId: string) => [teamId, userId],
});
