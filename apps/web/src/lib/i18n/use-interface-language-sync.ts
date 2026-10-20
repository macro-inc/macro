import { useUserLanguageQuery } from '@queries/auth/user-language';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createEffect } from 'solid-js';
import { setInterfaceLanguage } from './i18n';
import { resolveInterfaceLanguage } from './languages';

/**
 * Keeps the interface language in step with the account: the user's own
 * language, else their team's, else English. Until both settings have loaded
 * the language remembered on this device stays in place.
 */
export function useInterfaceLanguageSync() {
  const userLanguage = useUserLanguageQuery();
  const team = useCurrentTeamQuery();

  createEffect(() => {
    if (!queryReadyGate(userLanguage)) return;
    // A personal language doesn't need the team's, so a failed team request
    // only holds back people who follow the team language.
    if (
      !queryReadyGate(team) &&
      (!team.isError || userLanguage.data.language === null)
    )
      return;
    setInterfaceLanguage(
      resolveInterfaceLanguage(
        userLanguage.data.language,
        queryReadyGate(team) ? team.data?.team.language : undefined
      )
    );
  });
}
