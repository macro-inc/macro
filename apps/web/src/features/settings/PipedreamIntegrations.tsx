import { PIPEDREAM_ICON_MAP } from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import {
  useDeletePipedreamConnectionMutation,
  usePipedreamConnectionsQuery,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import type {
  PipedreamCatalogEntryResponse,
  PipedreamConnectionResponse,
} from '@service-cognition/client';
import { Button, ToggleSwitch } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
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
              variant="outline"
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
          variant="outline"
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
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => props.entry,
    onConnected: (entry) => toast.success(`${entry.display_name} connected`),
  });

  return (
    <IntegrationRow
      icon={
        <PipedreamConnectorIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
        />
      }
      title={props.entry.display_name}
      description={props.entry.description ?? props.entry.app_slug}
    >
      <ConnectAction
        label="Connect"
        onClick={() => void connect()}
        loading={busy()}
      />
    </IntegrationRow>
  );
}

/**
 * The "MCP integrations" section of the Connections page: apps the user has
 * connected, then a searchable catalog of every connectable app, ranked by
 * popularity — all connecting through Pipedream, the single connect path.
 */
export function PipedreamIntegrationsSection() {
  const serversQuery = usePipedreamConnectionsQuery();

  const servers = () => serversQuery.data ?? [];
  const connectedSlugs = createMemo(
    () => new Set(servers().map((s) => s.app_slug))
  );

  const catalog = createPipedreamCatalogSearch(connectedSlugs);
  const catalogQuery = catalog.query;
  const browseResults = catalog.entries;

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
              variant="outline"
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

      <Show when={!serversQuery.isError && servers().length > 0}>
        <SettingsCard>
          <For each={servers()}>
            {(server) => <ServerRow server={server} />}
          </For>
        </SettingsCard>
      </Show>

      <SettingsCard>
        <div class="px-4 py-3">
          <input
            type="search"
            class="settings-input w-full"
            placeholder="Search all connectors..."
            value={catalog.searchInput()}
            onInput={(e) => catalog.onSearchInput(e.currentTarget.value)}
          />
        </div>

        <Show when={catalogQuery.isError}>
          <div class="px-6 py-6 text-center text-sm text-ink-muted">
            Couldn't load the connector catalog.
            <Button
              variant="outline"
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
              catalog.search().trim()
            }
          >
            <div class="px-6 py-6 text-center text-sm text-ink-muted">
              No connectors found for "{catalog.search().trim()}".
            </div>
          </Show>

          <Show when={catalogQuery.hasNextPage}>
            <div class="px-4 py-3 text-center">
              <Button
                variant="outline"
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
