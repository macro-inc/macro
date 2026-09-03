import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import XIcon from '@phosphor/x.svg';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AddCustomMcpDialog } from '../Integrations';
import { ConnectAction } from '../integration-ui';
import { IntegrationRow, SettingsCard, SettingsSection } from '../primitives';
import type { ConnectionsModel } from './model';
import {
  FEATURED_DISCOVER,
  PIPEDREAM_BROWSE_HIDDEN_SLUGS,
  providerIcon,
} from './provider-meta';
import { openConnectionsProvider } from './view-state';

export function DiscoverView(props: { model: ConnectionsModel }) {
  const alreadyHave = createMemo(() => {
    const slugs = new Set<string>();
    for (const row of props.model.capabilities) {
      if (row.status !== 'not-connected') slugs.add(row.provider);
    }
    for (const leftover of props.model.leftovers) {
      if (leftover.kind === 'pipedream') slugs.add(leftover.appSlug);
    }
    return slugs;
  });
  const catalog = createPipedreamCatalogSearch(
    () => PIPEDREAM_BROWSE_HIDDEN_SLUGS
  );
  const [addingCustom, setAddingCustom] = createSignal(false);

  const featured = createMemo(() => {
    const query = catalog.searchInput().trim().toLowerCase();
    return FEATURED_DISCOVER.filter((item) => {
      const haystack = `${item.name} ${item.note}`.toLowerCase();
      return !query || haystack.includes(query);
    });
  });

  const rest = createMemo(() => {
    const query = catalog.searchInput().trim().toLowerCase();
    return catalog.entries().filter((entry) => {
      if (!query) return true;
      return `${entry.display_name} ${entry.description ?? ''} ${entry.app_slug}`
        .toLowerCase()
        .includes(query);
    });
  });

  return (
    <div class="flex flex-col gap-10">
      <label class="relative block">
        <span class="sr-only">Search Connections</span>
        <input
          type="search"
          value={catalog.searchInput()}
          onInput={(event) => catalog.onSearchInput(event.currentTarget.value)}
          placeholder="Search Connections"
          class="settings-input h-11 w-full pr-10 [&::-webkit-search-cancel-button]:hidden"
        />
        <Show when={catalog.searchInput()}>
          <button
            type="button"
            aria-label="Clear search"
            class="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-ink/4 hover:text-ink focus-visible:bg-ink/6"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => catalog.onSearchInput('')}
          >
            <XIcon class="size-4" />
          </button>
        </Show>
      </label>

      <SettingsSection title="Featured">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <For each={featured()}>
            {(item) => (
              <SettingsCard>
                <button
                  type="button"
                  class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
                  onClick={() => openConnectionsProvider(item.id)}
                >
                  <IntegrationRow
                    icon={providerIcon(item.id)}
                    title={item.name}
                    description={item.note}
                  >
                    <Show when={alreadyHave().has(item.id)}>
                      <AddedMark />
                    </Show>
                    <CaretRightIcon class="size-4 text-ink-extra-muted" />
                  </IntegrationRow>
                </button>
              </SettingsCard>
            )}
          </For>
        </div>
        <Show when={featured().length === 0}>
          <p class="text-sm text-ink-muted">No featured Connections match.</p>
        </Show>
      </SettingsSection>

      <SettingsSection title="Browse">
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
            <For each={rest()}>
              {(entry) => (
                <CatalogRow
                  entry={entry}
                  added={alreadyHave().has(entry.app_slug)}
                />
              )}
            </For>
            <Show
              when={
                !catalog.query.isFetching &&
                rest().length === 0 &&
                featured().length === 0 &&
                catalog.search().trim()
              }
            >
              <p class="px-6 py-6 text-sm text-ink-muted">
                No Connections match that search.
              </p>
            </Show>
            <Show when={catalog.query.isFetching}>
              <div
                class="flex justify-center px-6 py-6"
                role="status"
                aria-label="Loading"
              >
                <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
              </div>
            </Show>
            <Show
              when={
                rest().length > 0 &&
                !catalog.query.isFetching &&
                catalog.query.hasNextPage
              }
            >
              <div class="px-4 py-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  depth={3}
                  onClick={() => void catalog.query.fetchNextPage()}
                >
                  Load more
                </Button>
              </div>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsCard>
        <button
          type="button"
          class="w-full text-left outline-none hover:bg-ink/4 focus-visible:bg-ink/6"
          onClick={() => setAddingCustom(true)}
        >
          <IntegrationRow
            icon={<PlusIcon />}
            title="Add custom MCP"
            description="Give Macro's agent access to the tools your team already uses."
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

function AddedMark() {
  return (
    <span class="inline-flex items-center gap-1 text-sm text-ink-muted">
      <CheckIcon class="size-3.5" />
      Added
    </span>
  );
}

function CatalogRow(props: {
  entry: PipedreamCatalogEntryResponse;
  added: boolean;
}) {
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
          class="size-8"
        />
      }
      title={props.entry.display_name}
      description={props.entry.description ?? props.entry.app_slug}
    >
      <Show
        when={props.added}
        fallback={
          <ConnectAction
            label="Connect"
            onClick={() => void connect()}
            loading={busy()}
          />
        }
      >
        <AddedMark />
      </Show>
    </IntegrationRow>
  );
}
