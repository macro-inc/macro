import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  FEATURED_MCP_SERVERS,
  type FeaturedMcpServer,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import CheckIcon from '@phosphor/check.svg';
import LockIcon from '@phosphor/lock-simple.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import {
  type ImportSource,
  useImportQuery,
  useRetryGatherMutation,
} from '@queries/import';
import {
  useMcpServersQuery,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  usePipedreamConnectionsQuery,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { createEffect, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import { ImportEntityPill } from '../ImportEntityPill';
import { createConnectorConnect } from '../useConnectorConnect';
import { ContinueButton, SkipButton } from './shared';

interface ConnectorStepProps {
  integration: OnboardingIntegration;
  onContinue: () => void;
  onSkip: () => void;
}

/** Each selected integration gets its own consent, connection, and import status. */
export function ConnectorStep(props: ConnectorStepProps) {
  return (
    <Show when={props.integration} keyed>
      {(integration) => {
        const server = FEATURED_MCP_SERVERS.find(
          (item) => item.app_slug === integration.id
        );
        return (
          <Show
            when={integration.id === 'github'}
            fallback={
              server ? (
                <NativeConnector
                  integration={integration}
                  server={server}
                  onContinue={props.onContinue}
                  onSkip={props.onSkip}
                />
              ) : (
                <CatalogConnector
                  integration={integration}
                  onContinue={props.onContinue}
                  onSkip={props.onSkip}
                />
              )
            }
          >
            <GithubConnector
              integration={integration}
              onContinue={props.onContinue}
              onSkip={props.onSkip}
            />
          </Show>
        );
      }}
    </Show>
  );
}

function importSource(id: string): ImportSource | undefined {
  return id === 'linear' || id === 'notion' || id === 'slack' ? id : undefined;
}

function integrationDetails(integration: OnboardingIntegration) {
  switch (integration.id) {
    case 'linear':
      return {
        description:
          'Bring your active issues into Macro, with the context your team needs to keep work moving.',
        features: [
          'Import relevant recent issues as Macro tasks.',
          'Keep issue descriptions, status, priority, and source links.',
          'Continue here while your import runs in the background.',
        ],
        permission:
          'You’ll review Linear’s permissions before authorizing. Your connection lets Macro discover recent issues and lets your agents work with Linear.',
      };
    case 'notion':
      return {
        description:
          'Give your documents a home alongside your conversations, tasks, and agents.',
        features: [
          'Import relevant recent pages as editable Macro documents.',
          'Preserve supported formatting, properties, and links to Notion.',
          'Pages are supported; Notion databases are not imported.',
        ],
        permission:
          'You choose what to authorize in Notion. Macro uses that access to discover and import pages available to your account.',
      };
    case 'slack':
      return {
        description:
          'Bring your team’s channels and context into the same workspace as your work.',
        features: [
          'Discover relevant channels from your Slack workspace.',
          'Bring channel names, purposes, and available participant details into Macro.',
          'This imports channel structure, not your message history.',
        ],
        permission:
          'Review Slack’s permissions before authorizing. Macro uses your access to find channels and give your agents connected Slack tools.',
      };
    default:
      return {
        description: `Let your agents work with ${integration.name} alongside the rest of your workspace.`,
        features: [
          `Authorize ${integration.name} with your own account.`,
          'Review the requested permissions before you connect.',
          'Manage or disconnect this integration in Settings anytime.',
        ],
        permission:
          'This connects tools for your agents. It does not automatically migrate your data into Macro.',
      };
  }
}

/** Pure connection-page presentation, also useful for preview and visual checks. */
export function IntegrationConnectionPanel(props: {
  integration: OnboardingIntegration;
  connected: boolean;
  checking?: boolean;
  busy?: boolean;
  error?: boolean;
  actionLabel?: string;
  onConnect: () => void;
  onRetry: () => void;
  onContinue: () => void;
  onSkip: () => void;
  children?: JSX.Element;
}) {
  const details = () => integrationDetails(props.integration);
  return (
    <div class="mx-auto flex w-full max-w-xl flex-col gap-7">
      <div class="flex flex-col items-center gap-5 text-center">
        <span class="glass flex size-20 items-center justify-center rounded-3xl bg-ink/5">
          <PipedreamConnectorIcon
            appSlug={props.integration.id}
            iconUrl={props.integration.iconUrl}
            class="size-9"
          />
        </span>
        <div class="flex flex-col gap-3">
          <h1 class="text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Connect {props.integration.name}.
          </h1>
          <p class="text-base leading-7 text-ink-muted">
            {details().description}
          </p>
        </div>
      </div>
      <div
        class="overflow-hidden rounded-3xl border border-edge bg-ink/[0.025] p-5 sm:p-7"
        style={{
          'box-shadow':
            'inset 0 1px 0 color-mix(in srgb, var(--color-ink) 8%, transparent), 0 12px 40px color-mix(in srgb, var(--color-surface) 55%, transparent)',
        }}
      >
        <ul class="flex flex-col gap-4">
          <For each={details().features}>
            {(feature) => (
              <li class="flex items-start gap-3 text-sm leading-6 text-ink-muted">
                <CheckIcon class="mt-1 size-4 shrink-0 text-ink/65" />
                {feature}
              </li>
            )}
          </For>
        </ul>
        <div class="mt-6 border-t border-edge pt-6">
          <Show
            when={!props.error}
            fallback={
              <div
                role="alert"
                class="flex flex-col items-center gap-3 text-center text-sm text-ink-muted"
              >
                Couldn’t check this connection.
                <button
                  type="button"
                  class="underline underline-offset-4"
                  onClick={props.onRetry}
                >
                  Try again
                </button>
              </div>
            }
          >
            <Show
              when={!props.connected}
              fallback={
                <p
                  role="status"
                  class="flex items-center justify-center gap-2 text-sm text-ink"
                >
                  <CheckIcon class="size-4 text-success" />
                  {props.integration.name} connected
                </p>
              }
            >
              <button
                type="button"
                disabled={props.checking || props.busy}
                onClick={props.onConnect}
                class="flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-ink px-5 py-3 text-sm font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Show
                  when={!props.busy && !props.checking}
                  fallback={<SpinnerIcon class="size-4 animate-spin" />}
                >
                  <PipedreamConnectorIcon
                    appSlug={props.integration.id}
                    iconUrl={props.integration.iconUrl}
                    class="size-4"
                  />
                </Show>
                {props.checking
                  ? 'Checking connection…'
                  : props.busy
                    ? 'Connecting…'
                    : (props.actionLabel ??
                      `Connect ${props.integration.name}`)}
              </button>
            </Show>
          </Show>
        </div>
      </div>
      <p class="flex gap-2.5 text-xs leading-5 text-ink-muted">
        <LockIcon class="mt-0.5 size-4 shrink-0 text-ink/40" />
        {details().permission} You can disconnect in Settings.
      </p>
      {props.children}
      <Show when={props.connected}>
        <ContinueButton onClick={props.onContinue} />
      </Show>
      <Show when={!props.connected}>
        <SkipButton
          label="Skip this integration"
          disabled={props.busy}
          onClick={props.onSkip}
        />
      </Show>
    </div>
  );
}

function NativeConnector(
  props: ConnectorStepProps & { server: FeaturedMcpServer }
) {
  const pipedream = usePipedreamMcpFlag();
  const servers = useMcpServersQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const connections = usePipedreamConnectionsQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const native = () =>
    servers.isSuccess
      ? servers.data.find((item) => item.url === props.server.url)
      : undefined;
  const hosted = () =>
    connections.isSuccess
      ? connections.data.find((item) => item.app_slug === props.integration.id)
      : undefined;
  const authorized = () =>
    pipedream() ? hosted() !== undefined : native()?.authenticated === true;
  const connected = () =>
    authorized() &&
    (pipedream() ? hosted()?.enabled === true : native()?.enabled === true);
  const checking = () =>
    pipedream()
      ? connections.isPending || connections.isPlaceholderData
      : servers.isPending || servers.isPlaceholderData;
  const error = () => (pipedream() ? connections.isError : servers.isError);
  const updateNative = useUpdateMcpServerMutation();
  const updateHosted = useUpdatePipedreamConnectionMutation();
  const connection = createConnectorConnect({
    server: props.server,
    connected: () => native() !== undefined,
    authenticated: authorized,
  });
  const connect = async () => {
    if (!authorized()) {
      await connection.connect();
      return;
    }
    try {
      if (pipedream())
        await updateHosted.mutateAsync({
          app_slug: props.integration.id,
          enabled: true,
        });
      else
        await updateNative.mutateAsync({
          url: props.server.url,
          enabled: true,
        });
    } catch {
      toast.failure(`Couldn’t enable ${props.integration.name}. Try again.`);
    }
  };
  const analytics = useAnalytics();
  let wasConnected: boolean | undefined;
  createEffect(() => {
    if (checking() || error()) return;
    const value = connected();
    if (wasConnected === false && value)
      analytics.track('onboarding_v4_connector_connected', {
        connector: props.integration.id,
      });
    wasConnected = value;
  });
  return (
    <IntegrationConnectionPanel
      integration={props.integration}
      connected={connected()}
      checking={checking()}
      busy={
        connection.busy() || updateNative.isPending || updateHosted.isPending
      }
      error={error()}
      actionLabel={
        authorized() ? `Enable ${props.integration.name}` : undefined
      }
      onConnect={() => void connect()}
      onRetry={() => {
        if (pipedream()) void connections.refetch();
        else void servers.refetch();
      }}
      onContinue={props.onContinue}
      onSkip={props.onSkip}
    >
      <Show when={connected() && importSource(props.integration.id)}>
        {(source) => <ImportProgress source={source()} />}
      </Show>
    </IntegrationConnectionPanel>
  );
}

function CatalogConnector(props: ConnectorStepProps) {
  const query = usePipedreamConnectionsQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const update = useUpdatePipedreamConnectionMutation();
  const record = () =>
    query.isSuccess
      ? query.data.find((item) => item.app_slug === props.integration.id)
      : undefined;
  const analytics = useAnalytics();
  const connection = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.integration.id,
      display_name: props.integration.name,
    }),
    onConnected: () =>
      analytics.track('onboarding_v4_connector_connected', {
        connector: props.integration.id,
      }),
  });
  const connect = async () => {
    if (!record()) {
      await connection.connect();
      return;
    }
    try {
      await update.mutateAsync({
        app_slug: props.integration.id,
        enabled: true,
      });
    } catch {
      toast.failure(`Couldn’t enable ${props.integration.name}. Try again.`);
    }
  };
  return (
    <IntegrationConnectionPanel
      integration={props.integration}
      connected={record()?.enabled === true}
      checking={query.isPending || query.isPlaceholderData}
      busy={connection.busy() || update.isPending}
      error={query.isError}
      actionLabel={record() ? `Enable ${props.integration.name}` : undefined}
      onConnect={() => void connect()}
      onRetry={() => void query.refetch()}
      onContinue={props.onContinue}
      onSkip={props.onSkip}
    />
  );
}

function ImportProgress(props: { source: ImportSource }) {
  const query = useImportQuery();
  const retry = useRetryGatherMutation();
  const run = () =>
    query.isSuccess
      ? query.data.runs.find((item) => item.source === props.source)
      : undefined;
  const entities = () =>
    query.isSuccess
      ? query.data.entities.filter(
          (item) => item.source === props.source && item.status !== 'discarded'
        )
      : [];
  const imported = () =>
    entities().filter((item) => item.status === 'imported').length;
  return (
    <div class="rounded-2xl border border-edge bg-ink/[0.025] p-5">
      <div role="status" class="text-sm leading-6 text-ink-muted">
        <Switch
          fallback={
            <>
              Your connection is ready. We’ll look for relevant work to bring
              over in the background.
            </>
          }
        >
          <Match when={query.isError}>
            We couldn’t check import progress. Your connection is saved.
            <button
              type="button"
              class="ml-2 underline"
              onClick={() => void query.refetch()}
            >
              Retry
            </button>
          </Match>
          <Match when={run()?.status === 'failed'}>
            The import needs another try. Your connection is saved.
            <button
              type="button"
              disabled={retry.isPending}
              class="ml-2 underline disabled:opacity-50"
              onClick={() => retry.mutate(props.source)}
            >
              Retry import
            </button>
          </Match>
          <Match when={run()?.status === 'running'}>
            Finding relevant recent work to bring into Macro…
          </Match>
          <Match when={run()?.status === 'importing'}>
            Importing your work. You can continue while this runs.
          </Match>
          <Match when={imported() > 0}>
            {imported()} {imported() === 1 ? 'item is' : 'items are'} ready in
            Macro.
          </Match>
          <Match when={run()?.status === 'completed'}>
            Import check complete. You can ask your agent to bring over specific
            items later.
          </Match>
        </Switch>
      </div>
      <Show when={entities().length > 0}>
        <div class="mt-4 flex flex-wrap gap-2">
          <For each={entities().slice(0, 6)}>
            {(entity) => <ImportEntityPill entity={entity} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function GithubConnector(props: ConnectorStepProps) {
  const query = useGithubLinkStatusQuery();
  const init = useInitGithubLinkMutation();
  const reauthenticate = useReauthenticateGithubMutation();
  const status = () => (query.isSuccess ? query.data.status : undefined);
  const connected = () => status() === 'linked';
  const connect = async () => {
    try {
      window.location.href =
        status() === 'reauthentication_required'
          ? await reauthenticate.mutateAsync(window.location.href)
          : await init.mutateAsync(window.location.href);
    } catch {
      toast.failure('Couldn’t start GitHub authorization. Try again.');
    }
  };
  return (
    <div class="mx-auto flex w-full max-w-xl flex-col gap-7">
      <div class="flex flex-col items-center gap-5 text-center">
        <span class="glass flex size-20 items-center justify-center rounded-3xl bg-ink/5">
          <PipedreamConnectorIcon appSlug="github" class="size-9" />
        </span>
        <div class="flex flex-col gap-3">
          <h1 class="text-3xl font-medium tracking-tight sm:text-4xl">
            Bring GitHub into Macro.
          </h1>
          <p class="text-base leading-7 text-ink-muted">
            Connect your account, then choose the repositories Macro can sync.
          </p>
        </div>
      </div>
      <div class="flex flex-col overflow-hidden rounded-3xl border border-edge bg-ink/[0.025]">
        <div class="flex gap-4 p-5 sm:p-7">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full border border-edge text-xs text-ink-muted">
            1
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <h2 class="text-base font-medium">Connect your GitHub account</h2>
            <p class="text-sm leading-6 text-ink-muted">
              Identify your GitHub activity in Macro. You’ll review access on
              GitHub before authorizing.
            </p>
            <Show
              when={connected()}
              fallback={
                <button
                  type="button"
                  disabled={
                    query.isPending ||
                    init.isPending ||
                    reauthenticate.isPending
                  }
                  onClick={() => void connect()}
                  class="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <PipedreamConnectorIcon appSlug="github" class="size-4" />
                  {query.isPending
                    ? 'Checking…'
                    : init.isPending || reauthenticate.isPending
                      ? 'Opening GitHub…'
                      : status() === 'reauthentication_required'
                        ? 'Reconnect GitHub'
                        : 'Connect GitHub'}
                </button>
              }
            >
              <p role="status" class="flex items-center gap-2 text-sm">
                <CheckIcon class="size-4 text-success" />
                GitHub account connected
              </p>
            </Show>
          </div>
        </div>
        <div class="flex gap-4 border-t border-edge p-5 sm:p-7">
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full border border-edge text-xs text-ink-muted">
            2
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <h2 class="text-base font-medium">Choose repositories</h2>
            <p class="text-sm leading-6 text-ink-muted">
              Install the Macro GitHub App and choose the repositories you want
              to sync. GitHub may ask an organization administrator to approve
              access.
            </p>
            <Show
              when={connected()}
              fallback={
                <span class="flex items-center gap-2 text-xs text-ink-muted">
                  <LockIcon class="size-3.5" />
                  Connect your account first
                </span>
              }
            >
              <a
                href={`${SERVER_HOSTS['document-storage-service']}/github/install-sync`}
                target="_blank"
                rel="noopener noreferrer"
                class="glass mt-1 flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge bg-surface px-4 py-3 text-sm font-medium"
              >
                Choose repositories on GitHub
                <ArrowUpRightIcon class="size-4" />
              </a>
            </Show>
          </div>
        </div>
      </div>
      <p class="flex gap-2.5 text-xs leading-5 text-ink-muted">
        <LockIcon class="mt-0.5 size-4 shrink-0 text-ink/40" />
        Your account connection and repository access are separate. Manage the
        connection in Macro Settings and change repository access in GitHub.
      </p>
      <Show when={connected()}>
        <ContinueButton onClick={props.onContinue} />
      </Show>
      <Show when={!connected()}>
        <SkipButton
          label="Skip this integration"
          disabled={init.isPending || reauthenticate.isPending}
          onClick={props.onSkip}
        />
      </Show>
    </div>
  );
}
