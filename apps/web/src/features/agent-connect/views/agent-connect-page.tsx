import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { useAddInboxFlow, useEmailLinks } from '@core/email-link';
import { fireAndForget } from '@core/util/fireAndForget';
import LogoIcon from '@icon/macro-logo.svg';
import { Telemetry } from '@macro-inc/observability';
import { useIsAuthenticated, useUserInfo } from '@queries/auth';
import { queryReadyGate } from '@queries/gate';
import {
  connectPipedreamApp,
  usePipedreamConnectedSlugs,
} from '@queries/pipedream-connectors';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { Button, Surface } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import {
  type AgentConnectTarget,
  agentConnectTarget,
  hasLinkGuards,
  isExpired,
  isSameAccount,
} from '../core/agent-connect';

type Attempt =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'closed' }
  | { status: 'unsupported' }
  | { status: 'failed' };

/**
 * Where a person's own AI agent sends them to connect one tool during
 * agent-led setup (`/app/connect/:app`, from the `SetupConnect` MCP tool).
 *
 * The page opens the tool's own consent screen right away, so opening the
 * link is the only step on Macro's side. It runs signed in, and refuses to
 * connect a tool to a different Macro account than the one the agent set up.
 */
export function AgentConnectPage(props: { app: string }) {
  const [search] = useSearchParams<{ account?: string; expires?: string }>();
  const navigate = useNavigate();
  const userInfo = useUserInfo();
  const isAuthenticated = useIsAuthenticated();
  const analytics = useAnalytics();

  // A link without its account and expiry isn't one an agent was handed.
  const target = () =>
    hasLinkGuards(search.account, search.expires)
      ? agentConnectTarget(props.app)
      : undefined;
  const expired = () => isExpired(search.expires);
  const inboxProvider = () => {
    const app = target();
    return app?.kind === 'inbox' && app.provider === 'OUTLOOK'
      ? 'Microsoft'
      : 'Google';
  };
  // `undefined` while sign-in is still being checked. A browser that never
  // signed in to the web app (the agent's sign-in doesn't) reads `false`.
  const signedIn = () => isAuthenticated() === true;
  const sameAccount = () => isSameAccount(search.account, userInfo()?.email);

  const connectors = usePipedreamConnectedSlugs();
  const emailLinks = useEmailLinks();
  const [attempt, setAttempt] = createSignal<Attempt>({ status: 'idle' });
  const [connectedHere, setConnectedHere] = createSignal(false);

  const statusKnown = () => {
    const app = target();
    if (!app) return false;
    return app.kind === 'inbox'
      ? !emailLinks.query.isPending
      : connectors.ready();
  };
  const connected = () => {
    const app = target();
    if (!app) return false;
    if (connectedHere()) return true;
    if (app.kind === 'inbox') {
      // An inbox from the other provider doesn't count.
      return (
        queryReadyGate(emailLinks.query) &&
        emailLinks.query.data.links.some(
          (link) => link.provider === app.provider
        )
      );
    }
    return connectors.slugs().has(app.connectSlug);
  };

  const addInbox = useAddInboxFlow();

  const track = (event: string, data?: Record<string, unknown>) =>
    analytics.track(event, { app: target()?.app, ...data });

  const start = (app: AgentConnectTarget) =>
    Telemetry.span('agent_connect.start', async (span) => {
      span.setAttr('agent_connect.app', app.app);
      span.setAttr('agent_connect.kind', app.kind);
      setAttempt({ status: 'connecting' });
      track('agent_connect_started');
      try {
        if (app.kind === 'inbox') {
          // Leaves for the provider; the inbox callback brings the person
          // back here. Calendar comes with it, so this week's meetings are in
          // Macro from the start.
          const outcome = await addInbox({
            scopes: 'gmail_and_calendar',
            provider: app.provider,
          });
          span.setAttr('agent_connect.outcome', outcome);
          // Anything but leaving for the provider ends here: connected shows
          // as connected, anything else gets a retry.
          if (outcome !== 'left') {
            setAttempt({ status: 'closed' });
            if (outcome === 'stopped') track('agent_connect_closed');
          }
          return;
        }
        const outcome = await connectPipedreamApp({
          appSlug: app.connectSlug,
          serverName: app.name,
        });
        span.setAttr('agent_connect.outcome', outcome);
        if (outcome === 'connected') {
          setConnectedHere(true);
          setAttempt({ status: 'idle' });
          track('agent_connect_completed');
        } else {
          setAttempt({ status: outcome });
          track(
            outcome === 'closed'
              ? 'agent_connect_closed'
              : 'agent_connect_unsupported'
          );
        }
      } catch {
        // Third-party errors can carry connect URLs, so neither telemetry
        // nor the page repeats them.
        span.error('Agent connect failed');
        span.setAttr('agent_connect.outcome', 'failed');
        setAttempt({ status: 'failed' });
        track('agent_connect_failed');
      }
    });

  // Open the tool's consent screen as soon as the page knows it should: the
  // person already chose to connect by opening the link. This drives an
  // external flow (an iframe or a redirect), so it is an effect, and it runs
  // once per page load.
  let autoStarted = false;
  createEffect(
    on(
      () =>
        [
          target(),
          signedIn(),
          sameAccount(),
          expired(),
          statusKnown(),
        ] as const,
      ([app, isSignedIn, isSameAccount, isExpiredLink, known]) => {
        if (autoStarted || !app || !isSignedIn || !isSameAccount) return;
        if (isExpiredLink || !known || connected()) return;
        autoStarted = true;
        fireAndForget(start(app), 'agent-connect');
      }
    )
  );

  const signIn = () => {
    const returnUrl = `/connect/${encodeURIComponent(props.app)}${window.location.search}`;
    navigate(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  return (
    <div class="flex size-full overflow-y-auto p-8">
      <div class="m-auto w-full max-w-105">
        <Surface>
          <div class="flex flex-col gap-6 p-6 items-center text-center">
            <LogoIcon class="size-10 text-accent" />
            <Switch>
              <Match when={!target()}>
                <Message title="This link isn't right">
                  Go back to your agent and ask it for a new connect link.
                </Message>
              </Match>
              <Match when={expired()}>
                <Message title="This link has expired">
                  Go back to your agent and ask for a new link to connect{' '}
                  {target()!.name}.
                </Message>
              </Match>
              <Match when={isAuthenticated() === undefined}>
                <LoadingBlock />
              </Match>
              <Match when={!signedIn()}>
                <Message title={`Sign in to connect ${target()!.name}`}>
                  Use the same Google account you used in your agent.
                </Message>
                <Button onClick={signIn}>Sign in to Macro</Button>
              </Match>
              <Match when={!sameAccount()}>
                <Message title="This link is for another account">
                  It's for {search.account}, and you're signed in as{' '}
                  {userInfo()?.email}. Open it in a browser signed in as{' '}
                  {search.account}, or sign out of Macro here and open the link
                  again.
                </Message>
              </Match>
              <Match when={connected()}>
                <Message title={`${target()!.name} is connected`}>
                  Go back to your agent and say you're done.
                </Message>
              </Match>
              <Match when={attempt().status === 'unsupported'}>
                <Message title="Connections aren't available here">
                  Tell your agent {target()!.name} couldn't be connected right
                  now.
                </Message>
              </Match>
              <Match when={attempt().status === 'closed'}>
                <Message title={`${target()!.name} isn't connected yet`}>
                  Connecting didn't finish.
                </Message>
                <Button
                  onClick={() =>
                    fireAndForget(start(target()!), 'agent-connect')
                  }
                >
                  Connect {target()!.name}
                </Button>
              </Match>
              <Match when={attempt().status === 'failed'}>
                <Message title={`Couldn't connect ${target()!.name}`}>
                  Try again, or tell your agent it didn't work.
                </Message>
                <Button
                  onClick={() =>
                    fireAndForget(start(target()!), 'agent-connect')
                  }
                >
                  Try again
                </Button>
              </Match>
              <Match when={true}>
                <Message title={`Connecting ${target()!.name}`}>
                  <Show
                    when={target()!.kind === 'inbox'}
                    fallback={`Choose what Macro can read in the ${target()!.name} window.`}
                  >
                    Taking you to {inboxProvider()} to let Macro read and send
                    your mail and see your calendar.
                  </Show>
                </Message>
                <LoadingBlock />
              </Match>
            </Switch>
          </div>
        </Surface>
      </div>
    </div>
  );
}

function Message(props: { title: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <h2 class="text-lg font-medium text-ink">{props.title}</h2>
      <p class="text-sm text-ink-muted">{props.children}</p>
    </div>
  );
}
