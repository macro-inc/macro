import { useCurrentTeamQuery } from '@queries/team/teams';
import { type Accessor, createMemo } from 'solid-js';
import { createAssertedContextProvider } from './createContext';

export const MACRO_TEAM_SLUG = 'MACRO';

type TeamContextValue = {
  isMacroTeam: Accessor<boolean>;
};

export const [TeamContextProvider, useTeamContext] =
  createAssertedContextProvider('TeamContext', (): TeamContextValue => {
    const currentTeam = useCurrentTeamQuery();
    // Guarded: `data` suspends while the team query waits on sign-in, and this
    // provider wraps the whole app.
    const isMacroTeam = createMemo(
      () =>
        currentTeam.isSuccess && currentTeam.data?.team.slug === MACRO_TEAM_SLUG
    );

    return {
      isMacroTeam,
    };
  });

export function useIsMacroTeam() {
  return useTeamContext().isMacroTeam;
}
