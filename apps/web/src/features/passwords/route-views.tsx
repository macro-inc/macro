import { ViewShell } from '@app/components/view-shell';
import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useBeforeLeave } from '@app/lib/split-router';
import { usePending } from '@app/observability/flow';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enablePasswords } from '@core/constant/featureFlags';
import { idToDisplayName } from '@core/user/util';
import LockIcon from '@icon/system/regular/lock.svg';
import { useUserNames } from '@queries/auth';
import { isCurrentQueryAccount } from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createMemo, Match, onCleanup, Show, Suspense, Switch } from 'solid-js';
import { PasswordsProvider } from './context/passwords-context';
import { createAgentRequestSource } from './queries/agent-requests';
import { passwordRecipients } from './queries/recipients';
import { createPasswordSource } from './queries/source';
import {
  focusFromParams,
  type PasswordsFocus,
  VaultView,
} from './views/vault-view';

function PasswordsSkeleton() {
  return (
    <ViewShell.Root
      class="h-full min-h-0"
      asidePreferenceKey="passwords"
      aside={{ preserveDuringResize: false }}
      main={{ preferredWidth: 480 }}
      resizable
    >
      <ViewSkeleton.Sidebar
        title={t('passwords.title')}
        createLabel={t('passwords.newItem')}
      >
        <ViewSkeleton.Rows label={t('passwords.loading')} class="mt-3" />
      </ViewSkeleton.Sidebar>
      <ViewSkeleton.Main
        title={t('passwords.all')}
        controls={[t('passwords.newItem'), 1]}
        searchPlaceholder={t('passwords.search')}
      >
        <ViewSkeleton.Rows label={t('passwords.loading')} class="px-2" />
      </ViewSkeleton.Main>
    </ViewShell.Root>
  );
}

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
  const account = useQueryAccount();
  // Remount the vault, and drop its drafts, whenever the viewer's account,
  // sign-in session or team changes; nothing carries across viewers.
  const scope = createMemo(
    () => {
      const viewer = account();
      const teamId = team.isPending ? undefined : team.data?.team.id;
      return viewer && teamId
        ? {
            account: viewer,
            teamId,
            key: `${viewer.userId}:${viewer.session}:${teamId}`,
          }
        : undefined;
    },
    undefined,
    { equals: (previous, next) => previous?.key === next?.key }
  );
  let guard: () => Promise<boolean> = async () => true;
  useBeforeLeave(() => guard());
  // A notification opens Passwords on one of its items; a request for another
  // team than the viewer's current one opens the vault without a selection.
  const panel = useSplitPanel();
  let focusRequests = 0;
  const focus = createMemo((): PasswordsFocus | undefined => {
    const content = panel?.handle.content();
    if (content?.type !== 'component' || content.id !== 'passwords') return;
    return focusFromParams(content.params, scope()?.teamId, ++focusRequests);
  });
  return (
    <Suspense fallback={<PasswordsSkeleton />}>
      <Show
        when={scope()}
        keyed
        fallback={
          <Switch>
            <Match when={team.isPending || !account()}>
              <PasswordsSkeleton />
            </Match>
            <Match when={team.isError}>
              <p role="alert" class="p-4 text-sm">
                {t('passwords.failed')}
              </p>
            </Match>
            <Match when={true}>
              <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center touch:pt-(--mobile-content-inset-top)">
                <LockIcon class="size-5 text-ink-extra-muted" />
                <h2 class="text-sm font-semibold text-ink">
                  {t('passwords.noTeamTitle')}
                </h2>
                <p class="text-sm text-ink-muted">
                  {t('passwords.noTeamBody')}
                </p>
              </div>
            </Match>
          </Switch>
        }
      >
        {(current) => {
          // Ends with this viewer: in-flight requests stop, including any
          // waiting on a session refresh.
          const viewer = new AbortController();
          onCleanup(() => viewer.abort());
          const isCurrent = () => isCurrentQueryAccount(current.account);
          return (
            <PasswordsProvider
              value={{
                scope: {
                  key: current.key,
                  isCurrent: () => !viewer.signal.aborted && isCurrent(),
                },
                source: createPasswordSource(current.teamId, {
                  isCurrent,
                  signal: viewer.signal,
                }),
                recipients,
                recipientsLoading: () =>
                  team.isLoading || names().some((name) => name.loading),
                recipientsError: () =>
                  team.isError || names().some((name) => Boolean(name.error)),
                writeClipboard: (value) => navigator.clipboard.writeText(value),
              }}
            >
              <VaultView
                onGuard={(next) => {
                  guard = next;
                }}
                agentRequests={createAgentRequestSource(current.teamId, {
                  isCurrent,
                  signal: viewer.signal,
                })}
                focus={focus()}
              />
            </PasswordsProvider>
          );
        }}
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
