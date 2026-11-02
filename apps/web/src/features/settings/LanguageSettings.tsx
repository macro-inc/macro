import {
  browserInterfaceLanguage,
  DEFAULT_LANGUAGE,
  interfaceLanguage,
  LANGUAGES,
  type Language,
  nativeLanguageName,
  t,
} from '@app/lib/i18n';
import {
  useSetUserLanguageMutation,
  useUserLanguageQuery,
} from '@queries/auth/user-language';
import { queryReadyGate } from '@queries/gate';
import {
  useCurrentTeamQuery,
  useIsTeamAdmin,
  usePatchTeamMutation,
} from '@queries/team/teams';
import { Show } from 'solid-js';
import { SettingsSelect } from './components/settings-select';
import { SettingsCard, SettingsRow, SettingsSection } from './primitives';

/** The option for no explicit language: the team's, else the browser's. */
const AUTOMATIC = 'automatic';

/**
 * A language's own name, followed by its name in the current interface
 * language when that differs ("Deutsch · German").
 */
function languageOptionName(code: Language): string {
  const nativeName = nativeLanguageName(code);
  const localName = new Intl.DisplayNames([interfaceLanguage()], {
    type: 'language',
  }).of(code);
  return localName && localName.toLowerCase() !== nativeName.toLowerCase()
    ? `${nativeName} · ${localName}`
    : nativeName;
}

function languageOptions() {
  return LANGUAGES.map(({ code }) => ({
    id: code,
    name: languageOptionName(code),
  }));
}

function parseLanguage(id: string): Language | undefined {
  return LANGUAGES.find((language) => language.code === id)?.code;
}

/**
 * The team's default interface language and the person's own override. A
 * person without a team picks only their own.
 */
export function LanguageSettings() {
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const patchTeam = usePatchTeamMutation();
  const userLanguageQuery = useUserLanguageQuery();
  const setUserLanguage = useSetUserLanguageMutation();

  const team = () =>
    queryReadyGate(teamQuery) ? teamQuery.data?.team : undefined;
  const teamLanguage = () => team()?.language ?? null;
  /** What the interface shows when the person picks no language. */
  const automaticLanguage = () =>
    teamLanguage() ?? browserInterfaceLanguage ?? DEFAULT_LANGUAGE;
  const userLanguage = () =>
    queryReadyGate(userLanguageQuery)
      ? userLanguageQuery.data.language
      : undefined;

  const changeTeamLanguage = (id: string) => {
    const current = team();
    const language = id === AUTOMATIC ? null : parseLanguage(id);
    if (!current || language === undefined || language === teamLanguage())
      return;
    patchTeam.mutate({ teamId: current.id, request: { language } });
  };

  const changeUserLanguage = (id: string) => {
    const language = id === AUTOMATIC ? null : (parseLanguage(id) ?? null);
    if (language === (userLanguage() ?? null)) return;
    setUserLanguage.mutate(language);
  };

  return (
    <SettingsSection
      title={t('settingsLanguage.sectionTitle')}
      target="Language"
    >
      <SettingsCard>
        <Show when={team()}>
          {(currentTeam) => (
            <SettingsRow
              stackOnNarrow
              label={t('settingsLanguage.teamLanguage')}
              description={
                isTeamAdmin()
                  ? t('settingsLanguage.teamLanguageDescription', {
                      team: currentTeam().name,
                    })
                  : t('settingsLanguage.teamLanguageAdminOnly')
              }
            >
              <SettingsSelect
                label={t('settingsLanguage.teamLanguage')}
                class="w-full @[460px]:w-auto @[460px]:min-w-64 @[460px]:max-w-[22rem]"
                options={[
                  {
                    id: AUTOMATIC,
                    name: t('settingsLanguage.teamAutomatic'),
                  },
                  ...languageOptions(),
                ]}
                value={teamLanguage() ?? AUTOMATIC}
                onChange={changeTeamLanguage}
                disabled={!isTeamAdmin() || patchTeam.isPending}
              />
            </SettingsRow>
          )}
        </Show>
        <SettingsRow
          stackOnNarrow
          label={t('settingsLanguage.yourLanguage')}
          description={
            team()
              ? t('settingsLanguage.yourLanguageDescription')
              : t('settingsLanguage.yourLanguageNoTeamDescription')
          }
        >
          <SettingsSelect
            label={t('settingsLanguage.yourLanguage')}
            class="w-full @[460px]:w-auto @[460px]:min-w-64 @[460px]:max-w-[22rem]"
            options={[
              {
                id: AUTOMATIC,
                name: t(
                  teamLanguage()
                    ? 'settingsLanguage.useTeamLanguage'
                    : 'settingsLanguage.automatic',
                  { language: nativeLanguageName(automaticLanguage()) }
                ),
              },
              ...languageOptions(),
            ]}
            value={userLanguage() ?? AUTOMATIC}
            onChange={changeUserLanguage}
            disabled={!queryReadyGate(userLanguageQuery)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
