import { EmailCard } from '@app/features/settings/Email';
import { GitHubCard } from '@app/features/settings/GitHub';
import {
  FEATURED_MCP_SERVERS,
  PIPEDREAM_ICON_MAP,
  pipedreamAppAvailableInEnv,
  QUICK_CONNECT_ICON_MAP,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { useAddInboxFlow, useEmailLinksStatus } from '@core/email-link';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { proxyImageUrl } from '@core/util/imageProxy';
import { openExternalUrl } from '@core/util/url';
import GmailIcon from '@icon/mcp-gmail.svg';
import GithubIcon from '@icon/mcp-github.svg';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlugIcon from '@phosphor/plug.svg';
import {
  useGithubLinkStatusQuery,
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import {
  useAddMcpServerMutation,
  useDeleteMcpServerMutation,
  useMcpServersQuery,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  connectPipedreamApp,
  useDeletePipedreamConnectionMutation,
  usePipedreamCatalogQuery,
  usePipedreamConnectionsQuery,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import type {
  ServerResponse,
  StartAuthResponse,
} from '@service-cognition/generated/schemas';
import { Button, cn, Layer, ToggleSwitch } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';

import {
  type ExperimentalIntegrationSelection,
  useExperimentalPowersDetails,
} from './experimental-powers-details-context';

const FALLBACK_PIPEDREAM_CATALOG: PipedreamCatalogEntryResponse[] =
  FEATURED_MCP_SERVERS.map((server) => ({
    app_slug: server.app_slug,
    display_name: server.server_name,
    description: server.tagline,
    icon_url: null,
    priority: true,
  }));

type IntegrationSelection = ExperimentalIntegrationSelection;

function IntegrationCard(props: {
  name: string;
  icon: JSX.Element;
  connected: boolean;
  active?: boolean;
  attention?: boolean;
  loading?: boolean;
  connectLabel?: string;
  onConnect?: () => void;
  onOpen: () => void;
}) {
  const statusLabel = () => {
    if (props.loading) return 'Checking connection';
    if (props.attention) return 'Reconnect required';
    return props.connected ? 'Connected' : 'Not connected';
  };

  return (
    <div
      class={cn(
        'flex min-w-0 w-full flex-col overflow-hidden rounded-2xl border transition-colors',
        props.active
          ? 'border-ink/15 bg-active'
          : 'border-edge bg-transparent hover:border-ink/15 hover:bg-hover'
      )}
      onClick={props.onOpen}
    >
      <div class="flex w-full items-center justify-between gap-3 px-4 pt-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-edge text-ink [&_img]:size-5 [&_svg]:size-5">
          {props.icon}
        </div>
        <span
          class={cn(
            'size-2 shrink-0 rounded-full',
            props.attention
              ? 'bg-failure'
              : props.connected
                ? 'bg-success'
                : 'bg-ink/20'
          )}
          aria-label={statusLabel()}
          title={statusLabel()}
        />
      </div>
      <button
        type="button"
        class="flex min-w-0 flex-1 items-start px-4 pb-3 pt-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <span class="min-w-0 truncate text-base font-bold text-ink">
          {props.name}
        </span>
      </button>
    </div>
  );
}

function PipedreamIcon(props: {
  appSlug: string;
  iconUrl?: string | null;
}) {
  const BundledIcon = () => PIPEDREAM_ICON_MAP.get(props.appSlug);
  return (
    <Show
      when={BundledIcon()}
      fallback={
        <Show
          when={props.iconUrl}
          fallback={<PlugIcon class="size-6" />}
        >
          {(url) => (
            <img
              src={proxyImageUrl(url())}
              alt=""
              loading="lazy"
              class="size-6 rounded object-contain"
            />
          )}
        </Show>
      }
    >
      {(Icon) => {
        const C = Icon();
        return <C class="size-6" />;
      }}
    </Show>
  );
}

function NativeMcpIcon(props: { url: string }) {
  const Icon = () => QUICK_CONNECT_ICON_MAP.get(props.url);
  return (
    <Show when={Icon()} fallback={<PlugIcon class="size-6" />}>
      {(ResolvedIcon) => {
        const C = ResolvedIcon();
        return <C class="size-6" />;
      }}
    </Show>
  );
}

export function ExperimentalIntegrationIcon(props: {
  integration: Accessor<IntegrationSelection>;
}) {
  const pipedreamIntegration = createMemo(() => {
    const integration = props.integration();
    return integration.type === 'pipedream' ? integration : undefined;
  });
  const mcpIntegration = createMemo(() => {
    const integration = props.integration();
    return integration.type === 'mcp' ? integration : undefined;
  });

  return (
    <Switch>
      <Match when={props.integration().type === 'gmail'}>
        <GmailIcon />
      </Match>
      <Match when={props.integration().type === 'github'}>
        <GithubIcon />
      </Match>
      <Match when={pipedreamIntegration()}>
        {(integration) => (
          <PipedreamIcon
            appSlug={integration().appSlug}
            iconUrl={integration().iconUrl}
          />
        )}
      </Match>
      <Match when={mcpIntegration()}>
        {(integration) => <NativeMcpIcon url={integration().url} />}
      </Match>
    </Switch>
  );
}

function PipedreamCatalogCard(props: {
  entry: PipedreamCatalogEntryResponse;
  active: boolean;
  onOpen: () => void;
}) {
  const [connecting, setConnecting] = createSignal(false);
  const connect = async () => {
    if (connecting()) return;
    setConnecting(true);
    try {
      const outcome = await connectPipedreamApp({
        appSlug: props.entry.app_slug,
        serverName: props.entry.display_name,
      });
      if (outcome === 'connected') {
        toast.success(`${props.entry.display_name} connected`);
      } else if (outcome === 'unsupported') {
        toast.failure('Connectors are not available on this deployment');
      }
    } catch {
      toast.failure(`Failed to connect ${props.entry.display_name}`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <IntegrationCard
      name={props.entry.display_name}
      icon={
        <PipedreamIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
        />
      }
      connected={false}
      active={props.active}
      loading={connecting()}
      onConnect={() => void connect()}
      onOpen={props.onOpen}
    />
  );
}

function PipedreamCards(props: {
  search: string;
  selected?: IntegrationSelection;
  onOpen: (selection: IntegrationSelection) => void;
}) {
  const connectionsQuery = usePipedreamConnectionsQuery();
  const catalogQuery = usePipedreamCatalogQuery(() => props.search);
  const searchQuery = () => props.search.trim().toLocaleLowerCase();
  const connections = () => connectionsQuery.data ?? [];
  const visibleConnections = createMemo(() => {
    const query = searchQuery();
    if (!query) return connections();
    return connections().filter((server) =>
      `${server.server_name} ${server.app_slug}`
        .toLocaleLowerCase()
        .includes(query)
    );
  });
  const connectedSlugs = createMemo(
    () => new Set(connections().map((server) => server.app_slug))
  );
  const available = createMemo(() => {
    const entries = (catalogQuery.data?.pages ?? [])
      .flatMap((page) => page.servers)
      .filter((entry) => pipedreamAppAvailableInEnv(entry.app_slug));
    const source =
      entries.length > 0
        ? entries
        : searchQuery()
          ? []
          : FALLBACK_PIPEDREAM_CATALOG;
    return source.filter((entry) => {
      if (connectedSlugs().has(entry.app_slug)) return false;
      const query = searchQuery();
      return (
        !query ||
        `${entry.display_name} ${entry.app_slug} ${entry.description ?? ''}`
          .toLocaleLowerCase()
          .includes(query)
      );
    });
  });

  return (
    <>
      <For each={visibleConnections()}>
        {(server) => (
          <IntegrationCard
            name={server.server_name}
            icon={<PipedreamIcon appSlug={server.app_slug} />}
            connected
            active={
              props.selected?.type === 'pipedream' &&
              props.selected.appSlug === server.app_slug
            }
            onOpen={() =>
              props.onOpen({
                type: 'pipedream',
                name: server.server_name,
                appSlug: server.app_slug,
              })
            }
          />
        )}
      </For>
      <For each={available()}>
        {(entry) => (
          <PipedreamCatalogCard
            entry={entry}
            active={
              props.selected?.type === 'pipedream' &&
              props.selected.appSlug === entry.app_slug
            }
            onOpen={() =>
              props.onOpen({
                type: 'pipedream',
                name: entry.display_name,
                appSlug: entry.app_slug,
                iconUrl: entry.icon_url,
              })
            }
          />
        )}
      </For>
      <Show when={catalogQuery.hasNextPage}>
        <button
          type="button"
          class="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-edge px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          disabled={catalogQuery.isFetchingNextPage}
          onClick={() => void catalogQuery.fetchNextPage()}
        >
          {catalogQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      </Show>
    </>
  );
}

function NativeMcpCard(props: {
  server: ServerResponse;
  active: boolean;
  onOpen: () => void;
}) {
  const authMutation = useStartMcpAuthMutation();
  const connect = () => {
    authMutation.mutate(
      {
        server_url: props.server.url,
        server_name: props.server.server_name,
      },
      {
        onSuccess: (result: StartAuthResponse) =>
          openExternalUrl(result.authorization_url),
        onError: () => toast.failure('Failed to start authorization'),
      }
    );
  };

  return (
    <IntegrationCard
      name={props.server.server_name}
      icon={<NativeMcpIcon url={props.server.url} />}
      connected={props.server.authenticated}
      active={props.active}
      loading={authMutation.isPending}
      onConnect={connect}
      onOpen={props.onOpen}
    />
  );
}

function NativeMcpSuggestionCard(props: {
  server: (typeof FEATURED_MCP_SERVERS)[number];
  active: boolean;
  onOpen: () => void;
}) {
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const connect = async () => {
    try {
      await addMutation.mutateAsync({
        server_name: props.server.server_name,
        url: props.server.url,
      });
      const result = await authMutation.mutateAsync({
        server_name: props.server.server_name,
        server_url: props.server.url,
      });
      openExternalUrl(result.authorization_url);
    } catch {
      toast.failure(`Failed to connect ${props.server.server_name}`);
    }
  };

  return (
    <IntegrationCard
      name={props.server.server_name}
      icon={<props.server.icon class="size-6" />}
      connected={false}
      active={props.active}
      loading={addMutation.isPending || authMutation.isPending}
      onConnect={() => void connect()}
      onOpen={props.onOpen}
    />
  );
}

function NativeMcpCards(props: {
  search: string;
  selected?: IntegrationSelection;
  onOpen: (selection: IntegrationSelection) => void;
}) {
  const serversQuery = useMcpServersQuery();
  const searchQuery = () => props.search.trim().toLocaleLowerCase();
  const servers = () => serversQuery.data ?? [];
  const visibleServers = createMemo(() => {
    const query = searchQuery();
    if (!query) return servers();
    return servers().filter((server) =>
      `${server.server_name} ${server.url}`.toLocaleLowerCase().includes(query)
    );
  });
  const existingUrls = createMemo(() => new Set(servers().map((s) => s.url)));

  return (
    <>
      <For each={visibleServers()}>
        {(server) => (
          <NativeMcpCard
            server={server}
            active={
              props.selected?.type === 'mcp' &&
              props.selected.url === server.url
            }
            onOpen={() =>
              props.onOpen({
                type: 'mcp',
                name: server.server_name,
                url: server.url,
              })
            }
          />
        )}
      </For>
      <For
        each={FEATURED_MCP_SERVERS.filter((server) => {
          if (existingUrls().has(server.url)) return false;
          const query = searchQuery();
          return (
            !query ||
            `${server.server_name} ${server.tagline}`
              .toLocaleLowerCase()
              .includes(query)
          );
        })}
      >
        {(server) => (
          <NativeMcpSuggestionCard
            server={server}
            active={
              props.selected?.type === 'mcp' &&
              props.selected.url === server.url
            }
            onOpen={() =>
              props.onOpen({
                type: 'mcp',
                name: server.server_name,
                url: server.url,
              })
            }
          />
        )}
      </For>
    </>
  );
}

function DetailRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-12 items-center justify-between gap-3 py-2">
      <span class="text-sm text-ink-muted">{props.label}</span>
      <div class="flex shrink-0 items-center justify-end gap-2">
        {props.children}
      </div>
    </div>
  );
}

function PipedreamDetails(props: { appSlug: string; name: string }) {
  const query = usePipedreamConnectionsQuery();
  const updateMutation = useUpdatePipedreamConnectionMutation();
  const deleteMutation = useDeletePipedreamConnectionMutation();
  const [connecting, setConnecting] = createSignal(false);
  const connection = createMemo(() =>
    query.data?.find((server) => server.app_slug === props.appSlug)
  );

  const connect = async () => {
    if (connecting()) return;
    setConnecting(true);
    try {
      await connectPipedreamApp({
        appSlug: props.appSlug,
        serverName: props.name,
      });
    } catch {
      toast.failure(`Failed to connect ${props.name}`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <DetailRow label="Connection">
        <span class="text-xs text-ink-muted">
          {connection() ? 'Connected' : 'Not connected'}
        </span>
      </DetailRow>
      <Show
        when={connection()}
        fallback={
          <div class="pt-3">
            <Button
              variant="active"
              size="sm"
              class="h-9 w-full rounded-full"
              disabled={connecting()}
              onClick={() => void connect()}
            >
              {connecting() ? 'Connecting…' : 'Connect'}
              <Show when={!connecting()}>
                <ArrowUpRightIcon class="size-3.5" />
              </Show>
            </Button>
          </div>
        }
      >
        {(server) => (
          <>
            <DetailRow label="Agent access">
              <ToggleSwitch
                size="md"
                checked={server().enabled}
                disabled={updateMutation.isPending}
                label={server().enabled ? 'Enabled' : 'Disabled'}
                labelClass="sr-only"
                onChange={() =>
                  updateMutation.mutate({
                    app_slug: server().app_slug,
                    enabled: !server().enabled,
                  })
                }
              />
            </DetailRow>
            <div class="pt-3">
              <Button
                variant="danger"
                size="sm"
                class="w-full rounded-full"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({ app_slug: server().app_slug })
                }
              >
                {deleteMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function NativeMcpDetails(props: { url: string; name: string }) {
  const query = useMcpServersQuery();
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const server = createMemo(() =>
    query.data?.find((item) => item.url === props.url)
  );

  const connect = async () => {
    try {
      if (!server()) {
        await addMutation.mutateAsync({
          server_name: props.name,
          url: props.url,
        });
      }
      const result = await authMutation.mutateAsync({
        server_name: props.name,
        server_url: props.url,
      });
      openExternalUrl(result.authorization_url);
    } catch {
      toast.failure(`Failed to connect ${props.name}`);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <DetailRow label="Connection">
        <span class="text-xs text-ink-muted">
          {server()?.authenticated ? 'Connected' : 'Not connected'}
        </span>
      </DetailRow>
      <Show
        when={server()?.authenticated && server()}
        fallback={
          <div class="pt-3">
            <Button
              variant="active"
              size="sm"
              class="h-9 w-full rounded-full"
              disabled={addMutation.isPending || authMutation.isPending}
              onClick={() => void connect()}
            >
              {addMutation.isPending || authMutation.isPending
                ? 'Connecting…'
                : 'Connect'}
              <Show when={!addMutation.isPending && !authMutation.isPending}>
                <ArrowUpRightIcon class="size-3.5" />
              </Show>
            </Button>
          </div>
        }
      >
        {(connectedServer) => (
          <>
            <DetailRow label="Agent access">
              <ToggleSwitch
                size="md"
                checked={connectedServer().enabled}
                disabled={updateMutation.isPending}
                label={connectedServer().enabled ? 'Enabled' : 'Disabled'}
                labelClass="sr-only"
                onChange={() =>
                  updateMutation.mutate({
                    url: connectedServer().url,
                    enabled: !connectedServer().enabled,
                  })
                }
              />
            </DetailRow>
            <div class="pt-3">
              <Button
                variant="danger"
                size="sm"
                class="w-full rounded-full"
                disabled={deleteMutation.isPending}
                onClick={() =>
                  deleteMutation.mutate({ url: connectedServer().url })
                }
              >
                {deleteMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

/** Settings content for the integration selected in the Powers sidebar. */
export function ExperimentalIntegrationDetails(props: {
  integration: ExperimentalIntegrationSelection;
}) {
  return (
    <Switch>
      <Match when={props.integration.type === 'gmail'}>
        <EmailCard embedded />
      </Match>
      <Match when={props.integration.type === 'github'}>
        <GitHubCard embedded />
      </Match>
      <Match when={props.integration.type === 'pipedream'}>
        <PipedreamDetails
          appSlug={
            (
              props.integration as Extract<
                ExperimentalIntegrationSelection,
                { type: 'pipedream' }
              >
            ).appSlug
          }
          name={props.integration.name}
        />
      </Match>
      <Match when={props.integration.type === 'mcp'}>
        <NativeMcpDetails
          url={
            (
              props.integration as Extract<
                ExperimentalIntegrationSelection,
                { type: 'mcp' }
              >
            ).url
          }
          name={props.integration.name}
        />
      </Match>
    </Switch>
  );
}

/** Experimental integration grid controlled by the Powers details sidebar. */
export function ExperimentalIntegrationsView() {
  const pipedreamMcp = usePipedreamMcpFlag();
  const emailConnected = useEmailLinksStatus();
  const startAddInbox = useAddInboxFlow();
  const githubLink = useGithubLinkStatusQuery();
  const initGithubLink = useInitGithubLinkMutation();
  const reauthenticateGithub = useReauthenticateGithubMutation();
  const [emailConnecting, setEmailConnecting] = createSignal(false);
  const powersDetails = useExperimentalPowersDetails();
  const [search, setSearch] = createSignal('');
  const selected = () => {
    const detail = powersDetails?.detail();
    return detail?.kind === 'integration' ? detail.integration : undefined;
  };

  const matchesSearch = (...values: string[]) => {
    const query = search().trim().toLocaleLowerCase();
    return (
      !query || values.some((value) => value.toLocaleLowerCase().includes(query))
    );
  };

  const openIntegration = (integration: IntegrationSelection) => {
    powersDetails?.select({ kind: 'integration', integration });
  };

  const connectEmail = async () => {
    if (emailConnecting()) return;
    setEmailConnecting(true);
    try {
      await startAddInbox();
    } finally {
      setEmailConnecting(false);
    }
  };

  const connectGithub = async () => {
    try {
      const href =
        githubLink.data?.status === 'reauthentication_required'
          ? await reauthenticateGithub.mutateAsync(window.location.href)
          : await initGithubLink.mutateAsync(window.location.href);
      window.location.href = href;
    } catch {
      toast.failure('Failed to start GitHub connect flow');
    }
  };

  return (
    <Layer depth={2}>
      <main class="mx-2 mb-2 min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-10 pt-5 @max-[760px]/experimental-soup:mx-1 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
        <div class="mb-4 flex h-9 w-full max-w-md items-center gap-2 rounded-full bg-ink/4 px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent/30">
          <MagnifyingGlassIcon class="size-3.5 shrink-0" />
          <input
            type="search"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search integrations"
            class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
          />
        </div>
        <div
          class="grid min-w-0 justify-items-start gap-3"
          style={{
            'grid-template-columns':
              'repeat(auto-fit, minmax(min(100%, 16rem), 16rem))',
          }}
        >
          <Show when={matchesSearch('Gmail', 'Email', 'Calendar')}>
            <IntegrationCard
            name="Gmail"
            icon={<GmailIcon />}
            connected={emailConnected()}
            active={selected()?.type === 'gmail'}
            loading={emailConnecting()}
            onConnect={() => void connectEmail()}
            onOpen={() => openIntegration({ type: 'gmail', name: 'Gmail' })}
            />
          </Show>
          <Show when={matchesSearch('GitHub', 'Repositories')}>
            <IntegrationCard
            name="GitHub"
            icon={<GithubIcon />}
            connected={githubLink.data?.status === 'linked'}
            active={selected()?.type === 'github'}
            attention={githubLink.data?.status === 'reauthentication_required'}
            loading={githubLink.isLoading}
            connectLabel={
              githubLink.data?.status === 'reauthentication_required'
                ? 'Reconnect'
                : 'Connect'
            }
            onConnect={() => void connectGithub()}
            onOpen={() => openIntegration({ type: 'github', name: 'GitHub' })}
            />
          </Show>
          <Show
            when={pipedreamMcp()}
            fallback={
              <NativeMcpCards
                search={search()}
                selected={selected()}
                onOpen={openIntegration}
              />
            }
          >
            <PipedreamCards
              search={search()}
              selected={selected()}
              onOpen={openIntegration}
            />
          </Show>
        </div>
      </main>
    </Layer>
  );
}

