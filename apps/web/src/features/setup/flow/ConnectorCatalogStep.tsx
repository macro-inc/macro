import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { usePipedreamConnectionsQuery } from '@queries/pipedream-connectors';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { Button, cn, Layer } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { StatusDot } from '../../settings/integration-ui';
import { ContinueButton, SkipButton } from './shared';

/** One connectable app: click to run Pipedream's hosted Connect UI. */
function CatalogRow(props: {
  entry: PipedreamCatalogEntryResponse;
  onConnected: (entry: PipedreamCatalogEntryResponse) => void;
}) {
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => props.entry,
    onConnected: (entry) => props.onConnected(entry),
  });

  return (
    <Layer depth={2}>
      <button
        type="button"
        title={props.entry.description ?? props.entry.display_name}
        onClick={() => void connect()}
        class={cn(
          'group flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm',
          'cursor-default outline-none hover:border-ink/10 focus-visible:ring-1 focus-visible:ring-accent/50'
        )}
      >
        <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          <PipedreamConnectorIcon
            appSlug={props.entry.app_slug}
            iconUrl={props.entry.icon_url}
            class="size-4"
          />
        </span>
        <span class="min-w-0 truncate font-medium text-ink">
          {props.entry.display_name}
        </span>
        <span class="ml-auto shrink-0">
          <Show
            when={busy()}
            fallback={
              <span class="flex items-center gap-1 text-xs font-medium text-ink-muted group-hover:text-ink">
                Connect
                <ArrowUpRightIcon class="size-3 shrink-0" />
              </span>
            }
          >
            <span class="flex items-center gap-1.5 text-xs text-ink-muted">
              <SpinnerIcon class="size-3 shrink-0 animate-spin" />
              Connecting…
            </span>
          </Show>
        </span>
      </button>
    </Layer>
  );
}

/** An app connected on this step — the list's feedback that it landed. */
function ConnectedRow(props: { appSlug: string; name: string }) {
  return (
    <Layer depth={2}>
      <div class="flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/[0.05] bg-surface px-3.5 text-sm">
        <span class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
          <PipedreamConnectorIcon appSlug={props.appSlug} class="size-4" />
        </span>
        <span class="min-w-0 truncate font-medium text-ink">{props.name}</span>
        <span class="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
          <StatusDot state="connected" />
          Connected
        </span>
      </div>
    </Layer>
  );
}

/**
 * The catch-all connector step: everything Pipedream can connect, searchable
 * and ranked by popularity, for the tools that don't get a dedicated step.
 * Only reachable on the Pipedream stack — the native stack has no catalog to
 * browse, just the fixed presets the earlier steps already offered.
 */
export function ConnectorCatalogStep(props: {
  /** Slugs handled by their own step, left out to avoid re-offering them. */
  curatedSlugs: readonly string[];
  onContinue: () => void;
  onSkip: () => void;
}) {
  const analytics = useAnalytics();
  // Poll: connecting finishes inside the Connect UI iframe, so nothing else
  // would flip these rows.
  const connectionsQuery = usePipedreamConnectionsQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });

  const curated = createMemo(() => new Set(props.curatedSlugs));
  /** Connected here, i.e. everything outside the curated steps' remit. */
  const connected = createMemo(() =>
    (connectionsQuery.data ?? []).filter(
      (connection) => !curated().has(connection.app_slug)
    )
  );
  const exclude = createMemo(
    () =>
      new Set([
        ...curated(),
        ...(connectionsQuery.data ?? []).map((c) => c.app_slug),
      ])
  );

  const catalog = createPipedreamCatalogSearch(exclude);
  const query = catalog.query;

  const onConnected = (entry: PipedreamCatalogEntryResponse) => {
    analytics.track('onboarding_v4_connector_connected', {
      connector: entry.app_slug,
    });
    void connectionsQuery.refetch();
  };

  return (
    <div class="flex flex-col gap-3">
      <Show when={connected().length > 0}>
        <div class="flex flex-col gap-2">
          <For each={connected()}>
            {(connection) => (
              <ConnectedRow
                appSlug={connection.app_slug}
                name={connection.server_name}
              />
            )}
          </For>
        </div>
      </Show>

      <input
        type="search"
        placeholder="Search 2,000+ tools…"
        value={catalog.searchInput()}
        onInput={(e) => catalog.onSearchInput(e.currentTarget.value)}
        class="w-full rounded-lg border border-edge bg-surface px-4 py-3 text-sm text-ink transition-colors placeholder:text-ink-placeholder focus:border-accent focus:outline-none"
      />

      <Show
        when={!query.isError}
        fallback={
          <div class="flex flex-col items-center gap-2 py-6 text-center text-sm text-ink-muted">
            Couldn't load the connector catalog.
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        }
      >
        <div class="flex max-h-64 flex-col gap-2 overflow-y-auto">
          <For each={catalog.entries()}>
            {(entry) => <CatalogRow entry={entry} onConnected={onConnected} />}
          </For>

          <Show when={query.isFetching && catalog.entries().length === 0}>
            <p class="py-6 text-center text-sm text-ink-muted">
              Loading connectors…
            </p>
          </Show>

          <Show
            when={
              !query.isFetching &&
              catalog.entries().length === 0 &&
              catalog.search().trim()
            }
          >
            <p class="py-6 text-center text-sm text-ink-muted">
              No connectors found for "{catalog.search().trim()}".
            </p>
          </Show>

          <Show when={query.hasNextPage}>
            <Button
              variant="base"
              size="sm"
              depth={3}
              class="self-center"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </Show>
        </div>
      </Show>

      <Show
        when={connected().length > 0}
        fallback={<SkipButton onClick={props.onSkip} />}
      >
        <ContinueButton onClick={props.onContinue} />
      </Show>
    </div>
  );
}
