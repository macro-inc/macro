// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/queries/team/teams';
export function useIsTeamAdmin() {
  return () => true;
}

export function useIsTeamOwner() {
  return () => true;
}

export function useCurrentTeamQuery() {
  return {
    isPending: false,
    isSuccess: true,
    data: { id: 'team-1', team: { id: 'team-1', name: 'Macro' } },
  };
}

export function useUserTeamsQuery() {
  return { isPending: false, isSuccess: true, data: [{ id: 'team-1' }] };
}
