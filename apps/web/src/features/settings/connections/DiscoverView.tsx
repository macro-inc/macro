import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AddCustomMcpDialog } from '../Integrations';
import { ConnectAction } from '../integration-ui';
import { IntegrationRow, SettingsCard, SettingsSection } from '../primitives';
import type { ConnectionsModel } from './model';
import {
  DISCOVER_CATEGORIES,
  type DiscoverCategory,
  FEATURED_DISCOVER,
  tempCategoriesFor,
} from './provider-meta';
import { openConnectionsProvider } from './view-state';

export function DiscoverView(props: { model: ConnectionsModel }) {
  const connectedSlugs = createMemo(
    () =>
      new Set(
        props.model.capabilities
          .filter(
            (row) =>
              row.mechanism === 'pipedream' && row.status !== 'not-connected'
          )
          .map((row) => row.provider)
      )
  );
  const catalog = createPipedreamCatalogSearch(connectedSlugs);
  const [category, setCategory] = createSignal<DiscoverCategory>('all');
  const [addingCustom, setAddingCustom] = createSignal(false);

  const featured = createMemo(() => {
    const query = catalog.searchInput().trim().toLowerCase();
    const selected = category();
    return FEATURED_DISCOVER.filter((item) => {
      const haystack = `${item.name} ${item.note}`.toLowerCase();
      const queryOk = !query || haystack.includes(query);
      if (selected === 'all') return queryOk;
      return queryOk && tempCategoriesFor(item.id).includes(selected);
    });
  });

  const featuredSlugs = new Set(FEATURED_DISCOVER.map((item) => item.id));

  const rest = createMemo(() => {
    const query = catalog.searchInput().trim().toLowerCase();
    return catalog.entries().filter((entry) => {
      if (
        featuredSlugs.has(
          entry.app_slug as (typeof FEATURED_DISCOVER)[number]['id']
        )
      ) {
        return false;
      }
      const selected = category();
      const cats = tempCategoriesFor(entry.app_slug);
      if (selected !== 'all' && cats.length === 0) return false;
      if (selected !== 'all' && !cats.includes(selected)) return false;
      if (!query) return true;
      return `${entry.display_name} ${entry.description ?? ''} ${entry.app_slug}`
        .toLowerCase()
        .includes(query);
    });
  });

  return (
    <div class="flex flex-col gap-10">
      <label class="block">
        <span class="sr-only">Search providers</span>
        <input
          type="search"
          value={catalog.searchInput()}
          onInput={(event) => catalog.onSearchInput(event.currentTarget.value)}
          placeholder="Search providers"
          class="settings-input h-11 w-full"
        />
      </label>

      <SettingsSection title="Featured">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <For each={featured()}>
            {(item) => (
              <button
                type="button"
                class="rounded-xl border-1 border-ink/[0.05] bg-surface px-5 py-4 text-left outline-none hover:bg-ink/[0.02] focus-visible:bg-ink/4"
                onClick={() => openConnectionsProvider(item.id)}
              >
                <p class="text-sm font-medium text-ink">{item.name}</p>
                <p class="mt-1 text-xs text-ink-extra-muted">{item.note}</p>
              </button>
            )}
          </For>
        </div>
        <Show when={featured().length === 0}>
          <p class="text-sm text-ink-muted">No featured providers match.</p>
        </Show>
      </SettingsSection>

      <SettingsSection title="Browse">
        <div
          class="flex flex-wrap gap-1.5 px-6"
          role="tablist"
          aria-label="Provider categories"
        >
          <For each={DISCOVER_CATEGORIES}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={category() === item.id}
                class={`h-8 rounded-md px-3 text-sm outline-none focus-visible:bg-ink/6 ${
                  category() === item.id
                    ? 'bg-ink text-surface'
                    : 'bg-ink/5 text-ink-muted hover:bg-ink/8 hover:text-ink'
                }`}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <SettingsCard>
          <Show when={catalog.query.isError}>
            <div class="px-6 py-6 text-center text-sm text-ink-muted">
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
            <For each={rest()}>{(entry) => <CatalogRow entry={entry} />}</For>
            <Show
              when={
                catalog.query.isFetching &&
                rest().length === 0 &&
                featured().length === 0
              }
            >
              <p class="px-6 py-6 text-sm text-ink-muted">
                Loading connectors…
              </p>
            </Show>
            <Show
              when={
                !catalog.query.isFetching &&
                rest().length === 0 &&
                featured().length === 0 &&
                catalog.search().trim()
              }
            >
              <p class="px-6 py-6 text-sm text-ink-muted">
                No providers match that search.
              </p>
            </Show>
            <Show when={catalog.query.hasNextPage}>
              <div class="px-4 py-3 text-center">
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
        </SettingsCard>
      </SettingsSection>

      <SettingsCard>
        <button
          type="button"
          class="w-full text-left outline-none hover:bg-ink/[0.02] focus-visible:bg-ink/4"
          onClick={() => setAddingCustom(true)}
        >
          <IntegrationRow
            icon={<PlusIcon />}
            title="Add custom MCP"
            description="For a service Pipedream does not support."
          >
            <CaretRightIcon class="size-4 text-ink-extra-muted" />
          </IntegrationRow>
        </button>
      </SettingsCard>

      <AddCustomMcpDialog
        open={addingCustom()}
        onOpenChange={setAddingCustom}
      />
    </div>
  );
}

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
