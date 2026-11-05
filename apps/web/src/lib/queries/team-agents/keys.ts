import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ComputerSize } from '@service-auth/generated/schemas';

export const teamAgentKeys = createQueryKeys('team-agents', {
  list: (teamId: string) => [teamId],
  sizes: (teamId: string) => [teamId],
  voices: (teamId: string) => [teamId],
  voice: (teamId: string, userId: string) => [teamId, userId],
  sample: (teamId: string, model: string) => [teamId, model],
  quote: (teamId: string, size: ComputerSize) => [teamId, size],
});
