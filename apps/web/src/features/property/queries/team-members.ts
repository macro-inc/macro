import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { type Accessor, createMemo } from 'solid-js';

/** The authoritative team roster, independent of the viewer's contacts. */
export function useTeamMembers(enabled: Accessor<boolean>) {
  const query = useCurrentTeamQuery(enabled);
  const users = createMemo((): IUser[] => {
    if (!enabled() || !queryReadyGate(query)) return [];
    return (query.data?.members ?? []).map(({ user_id }) => ({
      id: user_id,
      email: idToEmail(user_id),
      name: idToDisplayName(user_id),
    }));
  });

  return {
    users,
    isLoading: () => enabled() && query.isPending,
    isError: () => enabled() && query.isError,
  };
}
