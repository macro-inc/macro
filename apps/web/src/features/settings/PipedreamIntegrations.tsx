import {
  FEATURED_MCP_SERVERS,
  PIPEDREAM_ICON_MAP,
  pipedreamAppAvailableInEnv,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import {
  connectPipedreamApp,
  useDeletePipedreamConnectionMutation,
  usePipedreamCatalogQuery,
  usePipedreamConnectionsQuery,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import type {
  PipedreamCatalogEntryResponse,
  PipedreamConnectionResponse,
} from '@service-cognition/client';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { ConnectAction } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsSection } from './primitives';

/** A connected app: enable/disable for tool use, or disconnect. */
function ServerRow(props: { server: PipedreamConnectionResponse }) {
  const updateMutation = useUpdatePipedreamConnectionMutation();
  const deleteMutation = useDeletePipedreamConnectionMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const handleToggleEnabled = () => {
    updateMutation.mutate(
      { app_slug: props.server.app_slug, enabled: !props.server.enabled },
      {
        onError: () => {
          toast.failure('Failed to update connector');
        },
      }
    );
  };

  const handleDelete = () => {
    deleteMutation.mutate(
      { app_slug: props.server.app_slug },
      {
        onSuccess: () => {
          toast.success('Connector removed');
          setConfirmDelete(false);
        },
        onError: () => {
          toast.failure('Failed to remove connector');
          setConfirmDelete(false);
        },
      }
    );
  };

  const Icon = () => PIPEDREAM_ICON_MAP.get(props.server.app_slug) ?? PlugIcon;

  return (
    <IntegrationRow
      icon={(() => {
        const C = Icon();
        return <C class="size-5" />;
      })()}
      title={props.server.server_name}
      description={props.server.app_slug}
    >
      <ToggleSwitch
        size="md"
        checked={props.server.enabled}
        disabled={updateMutation.isPending}
        onChange={handleToggleEnabled}
        label={props.server.enabled ? 'Enabled' : 'Disabled'}
        labelClass="inline-block w-14 text-left text-xs text-ink-muted whitespace-nowrap"
      />

      <Show
        when={!confirmDelete()}
        fallback={
          <div class="flex items-center gap-1">
            <Button
              variant="danger"
              size="sm"
              depth={3}
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? 'Removing...' : 'Confirm'}
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <Button
          variant="base"
          size="sm"
          depth={3}
          tooltip="Remove"
          onClick={() => setConfirmDelete(true)}
        >
          <XIcon class="size-4" />
        </Button>
      </Show>
    </IntegrationRow>
  );
}

/**
 * A connectable app from the catalog the user hasn't connected yet, shown
 * inline in the integrations list to make connecting a one-click affair.
 * Once connected, the app shows up as a regular {@link ServerRow} instead.
 */
function CatalogRow(props: { entry: PipedreamCatalogEntryResponse }) {
  const [busy, setBusy] = createSignal(false);

  const handleConnect = async () => {
    if (busy()) return;
    setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <IntegrationRow
      icon={<CatalogIcon entry={props.entry} />}
      title={props.entry.display_name}
      description={props.entry.description ?? props.entry.app_slug}
    >
      <ConnectAction label="Connect" onClick={handleConnect} loading={busy()} />
    </IntegrationRow>
  );
}

/**
 * Connector icon: our bundled SVG for the apps we ship icons for, the
 * directory-provided icon otherwise, and a generic plug as the fallback.
 */
function CatalogIcon(props: { entry: PipedreamCatalogEntryResponse }) {
  const BundledIcon = () => PIPEDREAM_ICON_MAP.get(props.entry.app_slug);
  return (
    <Show
      when={BundledIcon()}
      fallback={
        <Show
          when={props.entry.icon_url}
          fallback={<PlugIcon class="size-5" />}
        >
          {(iconUrl) => (
            <img
              src={iconUrl()}
              alt=""
              loading="lazy"
              class="size-5 rounded object-contain"
            />
          )}
        </Show>
      }
    >
      {(Icon) => {
        const C = Icon();
        return <C class="size-5" />;
      }}
    </Show>
  );
}

/**
 * Featured connectors as catalog entries, for when the catalog API hasn't
 * answered yet (or is unavailable): the same curated list the backend pins,
 * derived from the bundled presets so the section never renders empty.
 */
const FALLBACK_FEATURED: PipedreamCatalogEntryResponse[] =
  FEATURED_MCP_SERVERS.map((server) => ({
    app_slug: server.app_slug,
    display_name: server.server_name,
    description: server.tagline,
    icon_url: null,
    priority: true,
  }));

/**
 * The "MCP integrations" section of the Connections page: apps the user has
 * connected, then the curated featured connectors they haven't, then a
 * searchable catalog of every connectable app — all connecting through
 * Pipedream, the single connect path.
 */
export function PipedreamIntegrationsSection() {
  const serversQuery = usePipedreamConnectionsQuery();

  const [searchInput, setSearchInput] = createSignal('');
  const [search, setSearch] = createSignal('');
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const onSearchInput = (value: string) => {
    setSearchInput(value);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setSearch(value), 250);
  };
  onCleanup(() => clearTimeout(debounceTimer));

  const catalogQuery = usePipedreamCatalogQuery(search);
  // Separate un-searched instance backing the featured section, so it stays
  // put while the user types in the catalog search below. Same cache entry
  // as browsing with an empty search, so this costs no extra request.
  const featuredQuery = usePipedreamCatalogQuery(() => '');

  const servers = () => serversQuery.data ?? [];
  const connectedSlugs = () => new Set(servers().map((s) => s.app_slug));

  const offered = (entry: PipedreamCatalogEntryResponse) =>
    pipedreamAppAvailableInEnv(entry.app_slug) &&
    !connectedSlugs().has(entry.app_slug);

  const catalogEntries = () =>
    (catalogQuery.data?.pages ?? [])
      .flatMap((page) => page.servers)
      .filter(offered);

  // The featured section always shows the full curated list, served from
  // the presets bundled with the app until the catalog answers — the
  // backend pins the same list, so nothing jumps when it does.
  const featured = () => {
    const entries = (featuredQuery.data?.pages ?? [])
      .flatMap((page) => page.servers)
      .filter((entry) => entry.priority)
      .filter(offered);
    return entries.length > 0 ? entries : FALLBACK_FEATURED.filter(offered);
  };

  // Searching shows every match, with featured connectors ranked first by
  // the backend (flagged `priority`); browsing shows only organic directory
  // results, since the full featured list already sits above.
  const browseResults = () =>
    search().trim()
      ? catalogEntries()
      : catalogEntries().filter((entry) => !entry.priority);

  return (
    <SettingsSection
      title="MCP integrations"
      description="Connect the tools your team already uses to give Macro's agent access to them."
    >
      <Show when={serversQuery.isError}>
        <SettingsCard>
          <div class="px-6 py-8 text-center text-sm text-ink-muted">
            Failed to load integrations.
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => serversQuery.refetch()}
              class="ml-2"
            >
              Retry
            </Button>
          </div>
        </SettingsCard>
      </Show>

      <Show when={!serversQuery.isError}>
        <SettingsCard>
          <For each={servers()}>
            {(server) => <ServerRow server={server} />}
          </For>
          <For each={featured()}>{(entry) => <CatalogRow entry={entry} />}</For>
        </SettingsCard>
      </Show>

      <SettingsCard>
        <div class="px-4 py-3">
          <input
            type="search"
            class="settings-input w-full"
            placeholder="Search all connectors..."
            value={searchInput()}
            onInput={(e) => onSearchInput(e.currentTarget.value)}
          />
        </div>

        <Show when={catalogQuery.isError}>
          <div class="px-6 py-6 text-center text-sm text-ink-muted">
            Couldn't load the connector catalog.
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => catalogQuery.refetch()}
              class="ml-2"
            >
              Retry
            </Button>
          </div>
        </Show>

        <Show when={!catalogQuery.isError}>
          <For each={browseResults()}>
            {(entry) => <CatalogRow entry={entry} />}
          </For>

          <Show when={catalogQuery.isFetching && browseResults().length === 0}>
            <div class="px-6 py-6 text-center text-sm text-ink-muted">
              Loading connectors...
            </div>
          </Show>

          <Show
            when={
              !catalogQuery.isFetching &&
              browseResults().length === 0 &&
              search().trim()
            }
          >
            <div class="px-6 py-6 text-center text-sm text-ink-muted">
              No connectors found for "{search().trim()}".
            </div>
          </Show>

          <Show when={catalogQuery.hasNextPage}>
            <div class="px-4 py-3 text-center">
              <Button
                variant="base"
                size="sm"
                depth={3}
                disabled={catalogQuery.isFetchingNextPage}
                onClick={() => void catalogQuery.fetchNextPage()}
              >
                {catalogQuery.isFetchingNextPage ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          </Show>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}
