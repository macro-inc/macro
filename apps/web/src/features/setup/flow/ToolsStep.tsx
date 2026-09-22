import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  FEATURED_MCP_SERVERS,
  type FeaturedMcpServer,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import {
  useDeleteMcpServerMutation,
  useMcpServersQuery,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  usePipedreamConnectionsQuery,
} from '@queries/pipedream-connectors';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { createEffect, createSignal, For, Show, Suspense } from 'solid-js';
import { ToolTile } from '../components/ToolTile';
import { createConnectorConnect } from '../useConnectorConnect';
import type { OnboardingConnectorServerName } from './onboardingConnectorConfig';
import { ONBOARDING_CONNECTORS } from './onboardingConnectorConfig';
import { ContinueButton, SkipButton } from './shared';

export function ToolsStep(props: {
  connectorNames: readonly OnboardingConnectorServerName[];
  onContinue: () => void;
  onSkip: () => void;
}) {
  const pipedream = usePipedreamMcpFlag();
  const hiddenSlugs = () =>
    new Set(
      ONBOARDING_CONNECTORS.filter(
        (entry) => !props.connectorNames.includes(entry.serverName)
      ).map((entry) => entry.key)
    );
  return (
    <div class="flex flex-col gap-6">
      <Suspense
        fallback={
          <p class="py-8 text-center text-sm text-ink-muted">
            Loading your tools…
          </p>
        }
      >
        <Show
          when={pipedream()}
          fallback={<NativeTools connectorNames={props.connectorNames} />}
        >
          <CatalogTools hiddenSlugs={hiddenSlugs()} />
        </Show>
      </Suspense>
      <p class="text-center text-xs leading-5 text-ink-muted">
        Google email and calendar are managed in your connected accounts.
      </p>
      <SkipButton onClick={props.onSkip} />
      <ContinueButton label="Can I trust it?" onClick={props.onContinue} />
    </div>
  );
}

function ToolSearch(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-4 py-3 focus-within:ring-1 focus-within:ring-ink/30">
      <SearchIcon class="size-4 shrink-0 text-ink-muted" />
      <input
        aria-label="Search tools"
        placeholder="Search your tools…"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
      />
    </label>
  );
}

function NativeTools(props: {
  connectorNames: readonly OnboardingConnectorServerName[];
}) {
  const [search, setSearch] = createSignal('');
  const query = useMcpServersQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const servers = () =>
    FEATURED_MCP_SERVERS.filter((server) => {
      const configured = ONBOARDING_CONNECTORS.find(
        (entry) => entry.serverName === server.server_name
      );
      return (
        (!configured || props.connectorNames.includes(configured.serverName)) &&
        server.server_name.toLowerCase().includes(search().trim().toLowerCase())
      );
    });
  return (
    <div class="flex flex-col gap-6">
      <ToolSearch value={search()} onInput={setSearch} />
      <Show
        when={!query.isError}
        fallback={
          <button
            type="button"
            onClick={() => void query.refetch()}
            class="text-sm underline"
          >
            Couldn’t load connections. Try again.
          </button>
        }
      >
        <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
          <For each={servers()}>
            {(server) => (
              <NativeTool
                server={server}
                connected={(query.data ?? []).some(
                  (entry) => entry.url === server.url
                )}
                authenticated={(query.data ?? []).some(
                  (entry) => entry.url === server.url && entry.authenticated
                )}
                disabled={query.isPlaceholderData}
              />
            )}
          </For>
        </div>
        <Show when={servers().length === 0}>
          <p class="py-6 text-center text-sm text-ink-muted">
            No tools match “{search()}”. Try another name.
          </p>
        </Show>
      </Show>
    </div>
  );
}

function NativeTool(props: {
  server: FeaturedMcpServer;
  connected: boolean;
  authenticated: boolean;
  disabled: boolean;
}) {
  const analytics = useAnalytics();
  let wasAuthenticated: boolean | undefined;
  createEffect(() => {
    if (props.disabled) return;
    if (wasAuthenticated === false && props.authenticated) {
      analytics.track('onboarding_v4_connector_connected', {
        connector: props.server.server_name.toLowerCase(),
      });
    }
    wasAuthenticated = props.authenticated;
  });
  const disconnect = useDeleteMcpServerMutation();
  const connection = createConnectorConnect({
    server: props.server,
    connected: () => props.connected,
    authenticated: () => props.authenticated,
  });
  return (
    <ToolTile
      name={props.server.server_name}
      description={props.server.tagline}
      icon={<props.server.icon />}
      connected={props.authenticated}
      busy={connection.busy() || disconnect.isPending}
      disabled={props.disabled}
      onConnect={() => void connection.connect()}
      onDisconnect={() =>
        disconnect.mutate(
          { url: props.server.url },
          {
            onError: () =>
              toast.failure(
                `Couldn’t disconnect ${props.server.server_name}. Try again.`
              ),
          }
        )
      }
    />
  );
}

function CatalogTools(props: { hiddenSlugs: ReadonlySet<string> }) {
  const connections = usePipedreamConnectionsQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const catalog = createPipedreamCatalogSearch(() => props.hiddenSlugs);
  const [visibleCount, setVisibleCount] = createSignal(12);
  const connected = (slug: string) =>
    (connections.data ?? []).some((entry) => entry.app_slug === slug);
  const entries = () => (catalog.query.isSuccess ? catalog.entries() : []);
  return (
    <div class="flex flex-col gap-6">
      <ToolSearch
        value={catalog.searchInput()}
        onInput={(value) => {
          setVisibleCount(12);
          catalog.onSearchInput(value);
        }}
      />
      <Show
        when={!catalog.query.isError && !connections.isError}
        fallback={
          <button
            type="button"
            onClick={() => {
              void catalog.query.refetch();
              void connections.refetch();
            }}
            class="text-sm underline"
          >
            Couldn’t load tools. Try again.
          </button>
        }
      >
        <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
          <For each={entries().slice(0, visibleCount())}>
            {(entry) => (
              <CatalogTool
                entry={entry}
                connected={connected(entry.app_slug)}
                disabled={connections.isPlaceholderData}
              />
            )}
          </For>
        </div>
        <Show when={catalog.query.isFetching}>
          <p role="status" class="text-center text-xs text-ink-muted">
            Finding tools…
          </p>
        </Show>
        <Show when={!catalog.query.isFetching && entries().length === 0}>
          <p class="py-6 text-center text-sm text-ink-muted">
            No tools found. Try another name.
          </p>
        </Show>
        <Show
          when={entries().length > visibleCount() || catalog.query.hasNextPage}
        >
          <button
            type="button"
            disabled={catalog.query.isFetchingNextPage}
            onClick={() => {
              if (entries().length <= visibleCount())
                void catalog.query.fetchNextPage();
              setVisibleCount((value) => value + 12);
            }}
            class="self-center text-xs text-ink-muted underline underline-offset-4"
          >
            Show more tools
          </button>
        </Show>
      </Show>
    </div>
  );
}

function CatalogTool(props: {
  entry: PipedreamCatalogEntryResponse;
  connected: boolean;
  disabled: boolean;
}) {
  const analytics = useAnalytics();
  const disconnect = useDeletePipedreamConnectionMutation();
  const connection = createPipedreamCatalogConnect({
    entry: () => props.entry,
    onConnected: (entry) =>
      analytics.track('onboarding_v4_connector_connected', {
        connector: entry.app_slug,
      }),
  });
  return (
    <ToolTile
      name={props.entry.display_name}
      description={props.entry.description ?? undefined}
      icon={
        <PipedreamConnectorIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
        />
      }
      connected={props.connected}
      busy={connection.busy() || disconnect.isPending}
      disabled={props.disabled}
      onConnect={() => void connection.connect()}
      onDisconnect={() =>
        disconnect.mutate(
          { app_slug: props.entry.app_slug },
          {
            onError: () =>
              toast.failure(
                `Couldn’t disconnect ${props.entry.display_name}. Try again.`
              ),
          }
        )
      }
    />
  );
}
