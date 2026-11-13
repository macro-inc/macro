export function useIsTeamAdmin() {
  return () => true;
}

export function useIsTeamOwner() {
  return () => true;
}

export function useCurrentTeamQuery() {
  return { isPending: false, isSuccess: true, data: { id: 'team-1' } };
}

export function useUserTeamsQuery() {
  return { isPending: false, isSuccess: true, data: [{ id: 'team-1' }] };
}
