import { t } from '@app/lib/i18n';
import { useIsAuthenticated } from '@core/auth';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { getWebOrigin } from '@core/util/webOrigin';
import { useAgentSetupMutation } from '@queries/auth/agent-setup';
import { useCompleteTutorialMutation } from '@queries/auth/tutorial';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { createEffect, For, Match, type ParentProps, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { agentSetupMarkdown, markdownParts } from './core/agent-setup-markdown';

/** Who is looking at a setup page, and whether setup is theirs to finish. */
function useSetupStatus() {
  const userInfoQuery = useUserInfoQuery();
  const isAuthenticated = useIsAuthenticated();
  const navigate = useNavigate();

  const status = () => {
    if (isAuthenticated() === false) return 'signed-out';
    // A failed background refetch keeps its data: leaving the page then would
    // mint a new token and revoke the one the agent already saw.
    const settled = userInfoQuery.isSuccess || userInfoQuery.isRefetchError;
    if (!settled) return 'pending';
    const data = userInfoQuery.data;
    if (data?.isAgent === true && data.tutorialComplete === false) {
      return 'needs-setup';
    }
    return 'finished';
  };

  createEffect(() => {
    if (status() === 'signed-out') navigate('/login', { replace: true });
    if (status() === 'finished') navigate('/', { replace: true });
  });

  return status;
}

function PageFrame(props: ParentProps) {
  return (
    <div class="h-full overflow-y-auto bg-page p-6 text-ink">
      {props.children}
    </div>
  );
}

/** Markdown source with its links left clickable, so its text is the page. */
function MarkdownSource(props: { markdown: string }) {
  return (
    <For each={props.markdown.split('\n\n')}>
      {(block) => (
        <p class="mb-4 select-text whitespace-pre-wrap wrap-break-word font-mono text-sm">
          <For each={markdownParts(block)}>
            {(part) =>
              match(part)
                .with({ t: 'text' }, ({ text }) => text)
                .with({ t: 'link' }, ({ label, url }) => (
                  <>
                    [{label}](
                    <a href={url} target="_self" class="underline">
                      {url}
                    </a>
                    )
                  </>
                ))
                .exhaustive()
            }
          </For>
        </p>
      )}
    </For>
  );
}

/**
 * A new agent's first page: its SDK token and how to use it, as plain markdown
 * an agent driving a browser can read. The app sends the agent back here until
 * it follows the page's link to confirm it saved the token. Reloading replaces
 * the token, since a key can only be shown once.
 */
export function AgentSetupPage() {
  const status = useSetupStatus();
  const setup = useAgentSetupMutation();

  createEffect(() => {
    if (status() === 'needs-setup' && setup.isIdle) setup.mutate();
  });

  const markdown = (apiKey: string, teamJoinFailed: boolean) =>
    agentSetupMarkdown({
      apiKey,
      teamJoinFailed,
      openAppUrl: `${getWebOrigin()}/app/agent-setup/done`,
      copy: {
        title: t('agentSetup.title'),
        intro: t('agentSetup.intro'),
        teamJoinFailed: t('agentSetup.teamJoinFailed'),
        tokenLabel: t('agentSetup.tokenLabel'),
        useToken: t('agentSetup.useToken'),
        docsHeading: t('agentSetup.docsHeading'),
        productDocs: t('agentSetup.productDocs'),
        sdkDocs: t('agentSetup.sdkDocs'),
        setProfile: t('agentSetup.setProfile'),
        anotherToken: t('agentSetup.anotherToken'),
        anotherTokenSettings: t('agentSetup.anotherTokenSettings'),
        openApp: t('agentSetup.openApp'),
        openAppLink: t('agentSetup.openAppLink'),
      },
    });

  return (
    <PageFrame>
      <Switch fallback={<LoadingSpinner class="m-auto size-10 p-2" />}>
        <Match when={setup.isError}>
          <p class="text-ink-muted">{t('agentSetup.loadFailed')}</p>
          <Button
            class="self-start"
            variant="primary"
            size="sm"
            onClick={() => setup.mutate()}
          >
            {t('agentSetup.tryAgain')}
          </Button>
        </Match>
        <Match when={setup.data}>
          {(result) => (
            <MarkdownSource
              markdown={markdown(result().api_key, result().team_join_failed)}
            />
          )}
        </Match>
      </Switch>
    </PageFrame>
  );
}

/** Where the setup page's link lands: confirms the token, then opens the app. */
export function AgentSetupDonePage() {
  const status = useSetupStatus();
  const confirm = useCompleteTutorialMutation();

  createEffect(() => {
    if (status() === 'needs-setup' && confirm.isIdle) confirm.mutate();
  });

  return (
    <PageFrame>
      <Switch fallback={<LoadingSpinner class="m-auto size-10 p-2" />}>
        <Match when={confirm.isError}>
          <p class="text-ink-muted">{t('agentSetup.confirmFailed')}</p>
          <Button
            class="self-start"
            variant="primary"
            size="sm"
            onClick={() => confirm.mutate()}
          >
            {t('agentSetup.tryAgain')}
          </Button>
        </Match>
      </Switch>
    </PageFrame>
  );
}
