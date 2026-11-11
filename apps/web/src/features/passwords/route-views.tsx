import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useBeforeLeave } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enablePasswords } from '@core/constant/featureFlags';
import { idToDisplayName } from '@core/user/util';
import { useUserNames } from '@queries/auth';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createMemo, Show, Suspense } from 'solid-js';
import { PasswordsProvider } from './context/passwords-context';
import { passwordRecipients } from './queries/recipients';
import { createPasswordSource } from './queries/source';
import { VaultView } from './views/vault-view';

function PasswordsTeamView() {
  const team = useCurrentTeamQuery();
  const names = useUserNames({
    userIds: () =>
      team.isPending
        ? []
        : (team.data?.members ?? []).map((member) => member.user_id),
  });
  const recipients = createMemo(() =>
    passwordRecipients(
      team.isPending ? undefined : team.data,
      names().flatMap(({ name }) => (name ? [name] : [])),
      idToDisplayName
    )
  );
  usePageViewTracking('passwords');
  usePending('passwords.team', () => team.isLoading);
  usePending('passwords.recipients', () =>
    names().some((name) => name.loading)
  );
  let dirty: () => boolean = () => false;
  useBeforeLeave(() => !dirty());
  return (
    <Suspense fallback={<p class="p-4">{t('passwords.loading')}</p>}>
      <Show
        when={!team.isPending && team.data?.team.id}
        keyed
        fallback={
          <p class="p-4">
            {team.isError ? t('passwords.failed') : t('passwords.noTeam')}
          </p>
        }
      >
        {(teamId) => (
          <PasswordsProvider
            value={{
              source: createPasswordSource(teamId),
              recipients,
              recipientsLoading: () =>
                team.isLoading || names().some((name) => name.loading),
              recipientsError: () =>
                team.isError || names().some((name) => Boolean(name.error)),
              writeClipboard: (value) => navigator.clipboard.writeText(value),
            }}
          >
            <VaultView
              teamId={teamId}
              onGuard={(guard) => {
                dirty = guard;
              }}
            />
          </PasswordsProvider>
        )}
      </Show>
    </Suspense>
  );
}
export const PasswordsRouteView = withAuth(() => {
  const flag = useFeatureFlag(enablePasswords);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <PasswordsTeamView />
    </Show>
  );
});
