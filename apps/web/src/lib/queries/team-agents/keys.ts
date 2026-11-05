import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { ComputerSize } from '@service-auth/generated/schemas';

export const teamAgentKeys = createQueryKeys('team-agents', {
  list: (teamId: string) => [teamId],
  sizes: (teamId: string) => [teamId],
  quote: (teamId: string, size: ComputerSize) => [teamId, size],
});
