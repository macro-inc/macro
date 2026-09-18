import { createQueryKeys } from '@lukemorales/query-key-factory';

export const teamKeys = createQueryKeys('team', {
  userTeams: null,
  userInvites: null,
  currentTeam: null,
  privacy: (userId: string) => [userId],
  acceptInvite: null,
  rejectInvite: null,
  detail: (teamId: string) => [teamId],
  invites: (teamId: string) => [teamId],
});
