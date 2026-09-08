import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import XIcon from '@phosphor/x.svg';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import type { AgentMcpServer } from '@service-storage/generated/schemas/agentMcpServer';
import { Button } from '@ui';
import { type Accessor, createMemo, For, Show } from 'solid-js';
import {
  addMcpServer,
  catalogEntryToMcpServer,
  mcpServerConnectionState,
  removeMcpServer,
} from './agentMcpServers';
import { ConnectAction, StatusDot } from './integration-ui';
import { IntegrationRow } from './primitives';

/**
 * Picks Pipedream apps for an agent from the whole catalog, connected or
 * not, and shows for each picked app whether the *viewer* has connected it.
 *
 * Selection is the agent's; connection is personal. A teammate opening the
 * same agent sees their own dots, because a session spends the connections
 * of whoever runs it. So an unconnected pick is never an error here - it is
 * the agent's author saying "this agent uses Linear", and each person
 * connects Linear on their own, from this row or from Settings → Connections.
 */
export function PipedreamAppPicker(props: {
  selected: readonly AgentMcpServer[];
  onChange: (servers: AgentMcpServer[]) => void;
  /** The viewer's connected app slugs. */
  connectedSlugs: Accessor<ReadonlySet<string>>;
  /** False while the viewer's connections are still loading. */
  connectionsReady: Accessor<boolean>;
  /** Where the Connect iframe mounts; the enclosing dialog's content. */
  connectContainer: Accessor<HTMLElement | undefined>;
}) {
  const selectedSlugs = createMemo<ReadonlySet<string>>(
    () => new Set(props.selected.map((server) => server.app_slug))
  );
  const catalog = createPipedreamCatalogSearch(selectedSlugs);
  const searching = () => catalog.searchInput().trim().length > 0;

  const pick = (entry: PipedreamCatalogEntryResponse) => {
    props.onChange(
      addMcpServer(props.selected, catalogEntryToMcpServer(entry))
    );
    catalog.onSearchInput('');
  };

  return (
    <div class="flex flex-col gap-3">
      <input
        type="search"
        aria-label="Search connectors"
        class="settings-input w-full"
        placeholder="Search all connectors…"
        value={catalog.searchInput()}
        onInput={(event) => catalog.onSearchInput(event.currentTarget.value)}
      />

      <Show when={searching()}>
        <div
          role="listbox"
          aria-label="Connector results"
          class="max-h-64 overflow-y-auto rounded-lg border border-edge-muted"
        >
          <Show when={catalog.query.isError}>
            <div class="px-4 py-4 text-center text-sm text-ink-muted">
              Couldn't load the connector catalog.
              <Button
                variant="outline"
                size="sm"
                depth={3}
                onClick={() => catalog.query.refetch()}
                class="ml-2"
              >
                Retry
              </Button>
            </div>
          </Show>
          <Show when={!catalog.query.isError}>
            <For each={catalog.entries()}>
              {(entry) => (
                <CatalogResult
                  entry={entry}
                  connected={props.connectedSlugs().has(entry.app_slug)}
                  onPick={() => pick(entry)}
                />
              )}
            </For>
            <Show
              when={catalog.query.isFetching && catalog.entries().length === 0}
            >
              <div class="px-4 py-4 text-center text-sm text-ink-muted">
                Loading connectors…
              </div>
            </Show>
            <Show
              when={
                !catalog.query.isFetching &&
                catalog.entries().length === 0 &&
                catalog.search().trim()
              }
            >
              <div class="px-4 py-4 text-center text-sm text-ink-muted">
                No connectors found for "{catalog.search().trim()}".
              </div>
            </Show>
            <Show when={catalog.query.hasNextPage}>
              <div class="px-3 py-2 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  depth={3}
                  disabled={catalog.query.isFetchingNextPage}
                  onClick={() => void catalog.query.fetchNextPage()}
                >
                  {catalog.query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      <Show
        when={props.selected.length > 0}
        fallback={
          <p class="text-xs text-ink-extra-muted">
            No apps selected yet. Search above to add one.
          </p>
        }
      >
        <div class="divide-y divide-edge-muted rounded-lg border border-edge-muted">
          <For each={props.selected}>
            {(server) => (
              <SelectedAppRow
                server={server}
                connectedSlugs={props.connectedSlugs}
                connectionsReady={props.connectionsReady}
                connectContainer={props.connectContainer}
                onRemove={() =>
                  props.onChange(
                    removeMcpServer(props.selected, server.app_slug)
                  )
                }
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CatalogResult(props: {
  entry: PipedreamCatalogEntryResponse;
  connected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover focus-visible:bg-active outline-none"
      onClick={() => props.onPick()}
    >
      <PipedreamConnectorIcon
        appSlug={props.entry.app_slug}
        iconUrl={props.entry.icon_url}
        class="size-4"
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm text-ink">
          {props.entry.display_name}
        </span>
        <Show when={props.entry.description}>
          <span class="block truncate text-xs text-ink-muted">
            {props.entry.description}
          </span>
        </Show>
      </span>
      <Show when={props.connected}>
        <span class="flex items-center gap-1.5 text-xs text-ink-muted">
          <StatusDot state="connected" label="Connected" />
          Connected
        </span>
      </Show>
    </button>
  );
}

function SelectedAppRow(props: {
  server: AgentMcpServer;
  connectedSlugs: Accessor<ReadonlySet<string>>;
  connectionsReady: Accessor<boolean>;
  connectContainer: Accessor<HTMLElement | undefined>;
  onRemove: () => void;
}) {
  const state = () =>
    mcpServerConnectionState(props.server, props.connectedSlugs());
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => ({
      app_slug: props.server.app_slug,
      display_name: props.server.server_name,
    }),
    container: props.connectContainer,
  });

  return (
    <IntegrationRow
      class="px-3 py-2.5"
      icon={
        <PipedreamConnectorIcon
          appSlug={props.server.app_slug}
          class="size-5"
        />
      }
      title={props.server.server_name}
      description={props.server.app_slug}
      status={
        <Show
          when={props.connectionsReady()}
          fallback={<SpinnerIcon class="size-3 animate-spin text-ink-muted" />}
        >
          <StatusDot
            state={state()}
            label={state() === 'connected' ? 'Connected' : 'Not connected'}
          />
        </Show>
      }
    >
      <Show when={props.connectionsReady() && state() === 'disconnected'}>
        <ConnectAction
          label="Connect"
          loading={busy()}
          onClick={() => void connect()}
        />
      </Show>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${props.server.server_name}`}
        onClick={() => props.onRemove()}
      >
        <XIcon />
      </Button>
    </IntegrationRow>
  );
}
