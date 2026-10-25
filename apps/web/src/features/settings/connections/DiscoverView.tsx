import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckIcon from '@phosphor/check.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { Button, InputGroup, Tooltip } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { SettingsSelect } from '../components/settings-select';
import { IntegrationRow, SettingsSurface } from '../primitives';
import { AddCustomMcpDialog } from './add-custom-mcp-dialog';
import { groupCatalogByCategory } from './catalog-categories';
import type { ConnectionsModel } from './model';
import {
  EMPTY_STARTERS,
  PIPEDREAM_BROWSE_HIDDEN_SLUGS,
  providerIcon,
} from './provider-meta';
import { useConnectionsView } from './view-state';

export function DiscoverView(props: { model: ConnectionsModel }) {
  const view = useConnectionsView();
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

  const rest = createMemo(() => {
    const query = catalog.search().trim().toLowerCase();
    return catalog.entries().filter((entry) => {
      if (!query) return true;
      return `${entry.display_name} ${entry.description ?? ''} ${entry.app_slug}`
        .toLowerCase()
        .includes(query);
    });
  });

  const categories = createMemo(() => groupCatalogByCategory(rest()));
  const [selectedCategory, setSelectedCategory] = createSignal('all');
  const activeCategory = () =>
    categories().some((category) => category.name === selectedCategory())
      ? selectedCategory()
      : 'all';
  const visibleCategories = createMemo(() =>
    categories().filter(
      (category) =>
        activeCategory() === 'all' || category.name === activeCategory()
    )
  );
  const categoryOptions = createMemo(() => [
    { id: 'all', name: 'All categories' },
    ...categories().map((category) => ({
      id: category.name,
      name: category.name,
    })),
  ]);

  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const loadMore = () =>
    fireAndForget(catalog.query.fetchNextPage(), 'connections-settings');
  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () => catalog.query.hasNextPage && !catalog.query.isError,
    isFetchingNextPage: () => catalog.query.isFetching,
    fetchNextPage: loadMore,
  });

  return (
    <div class="@container/catalog flex flex-col gap-7">
      <section aria-label="Featured integrations">
        <h3 class="mb-2 text-sm font-medium text-ink-muted">Featured</h3>
        <div class="grid grid-cols-1 gap-3 @[440px]/catalog:grid-cols-2">
          <For each={EMPTY_STARTERS}>
            {(item) => (
              <SettingsSurface class="@container overflow-hidden">
                <button
                  type="button"
                  class="flex h-full w-full flex-col items-stretch text-left outline-none not-touch:hover:overlay-hover focus-visible:overlay-hover"
                  onClick={() => view.openProvider(item.id)}
                >
                  <IntegrationRow
                    icon={providerIcon(item.id)}
                    title={item.name}
                    class="gap-3 px-4 py-3"
                  >
                    <Show when={alreadyHave().has(item.id)}>
                      <AddedMark />
                    </Show>
                    <Show when={!alreadyHave().has(item.id)}>
                      <AddMark />
                    </Show>
                  </IntegrationRow>
                </button>
              </SettingsSurface>
            )}
          </For>
        </div>
      </section>

      <section aria-label="All integrations">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="text-base font-medium text-ink">All apps</h3>
          <Button
            variant="outline"
            size="md"
            onClick={() => setAddingCustom(true)}
          >
            <PlusIcon class="size-4" /> Add Custom
          </Button>
        </div>
        <div class="mb-5 grid grid-cols-1 items-end gap-3 @[560px]/catalog:grid-cols-[minmax(0,1fr)_14rem]">
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-xs font-medium text-ink-muted">Search apps</span>
            <InputGroup size="md">
              <InputGroup.Addon>
                <MagnifyingGlassIcon class="size-4" aria-hidden="true" />
              </InputGroup.Addon>
              <InputGroup.Input
                type="search"
                aria-label="Search apps"
                value={catalog.searchInput()}
                onInput={(event) => {
                  setSelectedCategory('all');
                  catalog.onSearchInput(event.currentTarget.value);
                }}
                placeholder="Search by name or description"
              />
              <InputGroup.Addon align="inline-end">
                <InputGroup.ClearButton />
              </InputGroup.Addon>
            </InputGroup>
          </div>
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-xs font-medium text-ink-muted">Category</span>
            <SettingsSelect
              label="Filter apps by category"
              options={categoryOptions()}
              value={activeCategory()}
              onChange={setSelectedCategory}
              class="min-w-0 w-full"
            />
          </div>
        </div>
        <div class="grid grid-cols-1 gap-6">
          <Show when={catalog.query.isError && catalog.entries().length === 0}>
            <div class="col-span-full px-6 py-6 text-center text-sm text-ink-muted">
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
          <Show when={!catalog.query.isError || catalog.entries().length > 0}>
            <For each={visibleCategories()}>
              {(category) => (
                <section class="col-span-full" aria-label={category.name}>
                  <div class="mb-2 flex items-center justify-between border-b border-edge-muted pb-2">
                    <h4 class="text-sm font-medium text-ink">
                      {category.name}
                    </h4>
                    <span
                      class="text-sm text-ink-muted"
                      aria-label={`${category.entries.length} apps`}
                    >
                      {category.entries.length}
                    </span>
                  </div>
                  <div class="grid grid-cols-1 gap-3 @[440px]/catalog:grid-cols-2">
                    <For each={category.entries}>
                      {(entry) => (
                        <CatalogRow
                          entry={entry}
                          added={alreadyHave().has(entry.app_slug)}
                        />
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
            <Show
              when={
                !catalog.query.isFetching &&
                rest().length === 0 &&
                catalog.search().trim()
              }
            >
              <p class="col-span-full px-6 py-6 text-sm text-ink-muted">
                No Connections match that search.
              </p>
            </Show>
            <Show when={catalog.query.isFetching}>
              <div
                class="col-span-full flex justify-center px-6 py-6"
                role="status"
                aria-label="Loading"
              >
                <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
              </div>
            </Show>
            <Show when={catalog.query.isFetchNextPageError}>
              <div class="col-span-full flex items-center justify-center gap-3 py-4 text-sm text-ink-muted">
                Couldn't load more apps.
                <Button variant="outline" size="sm" onClick={loadMore}>
                  Retry
                </Button>
              </div>
            </Show>
            <Show
              when={
                catalog.query.hasNextPage &&
                !catalog.query.isFetching &&
                !catalog.query.isError
              }
            >
              <div
                ref={setSentinel}
                class="col-span-full h-px"
                aria-hidden="true"
              />
            </Show>
          </Show>
        </div>
      </section>

      <AddCustomMcpDialog
        open={addingCustom()}
        onOpenChange={setAddingCustom}
        onAdded={view.showOverview}
      />
    </div>
  );
}

function AddMark(props: { loading?: boolean }) {
  return (
    <span
      aria-hidden="true"
      class="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/4 text-ink-muted"
    >
      <Show when={props.loading} fallback={<PlusIcon class="size-4" />}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
    </span>
  );
}

function AddedMark() {
  return (
    <span
      class="inline-flex shrink-0 items-center gap-1 text-sm text-ink-muted"
      aria-label="Added"
    >
      <CheckIcon class="size-3.5" />
      <span class="hidden @[16rem]:inline" aria-hidden="true">
        Added
      </span>
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

  const name = () => props.entry.display_name;
  const descriptionId = `discover-connect-${props.entry.app_slug}`;
  const description = props.entry.description ?? props.entry.app_slug;

  const row = () => (
    <IntegrationRow
      icon={
        <PipedreamConnectorIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
          class="size-8"
        />
      }
      class="gap-3 px-4 py-3"
      title={name()}
      description={
        <Tooltip label={description}>
          <span id={descriptionId} class="not-touch:line-clamp-1 text-sm">
            {description}
          </span>
        </Tooltip>
      }
    >
      <Show when={props.added} fallback={<AddMark loading={busy()} />}>
        <AddedMark />
      </Show>
    </IntegrationRow>
  );

  return (
    <SettingsSurface class="@container overflow-hidden">
      <Show when={!props.added} fallback={row()}>
        <button
          type="button"
          class="h-full w-full text-left outline-none not-touch:hover:overlay-hover focus-visible:overlay-hover"
          aria-label={busy() ? `Connecting ${name()}` : `Connect ${name()}`}
          aria-describedby={descriptionId}
          aria-busy={busy()}
          disabled={busy()}
          onClick={() => fireAndForget(connect(), 'connections-settings')}
        >
          {row()}
        </button>
      </Show>
    </SettingsSurface>
  );
}
