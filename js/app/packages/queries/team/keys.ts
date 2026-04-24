import { createQueryKeys } from '@lukemorales/query-key-factory';

export const teamKeys = createQueryKeys('team', {
  userTeams: null,
  userInvites: null,
  detail: (teamId: string) => [teamId],
  invites: (teamId: string) => [teamId],
});
