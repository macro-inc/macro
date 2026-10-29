import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  type createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { Button } from '@ui';
import { type Accessor, createSignal, For, Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { connectorDescription, ImportAction } from './import-action';
import { IntegrationListRow } from './integrations-list';

type CatalogSearch = ReturnType<typeof createPipedreamCatalogSearch>;

/** The directory's categories for an app, at most two. */
function catalogCategories(entry: PipedreamCatalogEntryResponse): string[] {
  return (entry.categories ?? [])
    .map((category) => category.trim())
    .filter(Boolean)
    .slice(0, 2);
}

/** Catalog apps not yet connected, loading more as the list scrolls. */
export function CatalogRows(props: {
  catalog: CatalogSearch;
  entries: Accessor<PipedreamCatalogEntryResponse[]>;
}) {
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const loadMore = () =>
    fireAndForget(props.catalog.query.fetchNextPage(), 'connections-settings');
  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () =>
      props.catalog.query.hasNextPage && !props.catalog.query.isError,
    isFetchingNextPage: () => props.catalog.query.isFetching,
    fetchNextPage: loadMore,
  });

  return (
    <>
      <For each={props.entries()}>
        {(entry) => <CatalogRow entry={entry} />}
      </For>
      <Show
        when={
          props.catalog.query.isError && props.catalog.entries().length === 0
        }
      >
        <div class="flex items-center justify-center gap-3 px-3 py-6 text-sm text-ink-muted">
          Couldn't load the app catalog.
          <Button
            variant="secondary"
            size="sm"
            onClick={() => props.catalog.query.refetch()}
          >
            Retry
          </Button>
        </div>
      </Show>
      <Show when={props.catalog.query.isFetching}>
        <div
          class="flex justify-center px-3 py-6"
          role="status"
          aria-label="Loading"
        >
          <SpinnerIcon class="size-4 animate-spin text-ink-muted" />
        </div>
      </Show>
      <Show when={props.catalog.query.isFetchNextPageError}>
        <div class="flex items-center justify-center gap-3 py-4 text-sm text-ink-muted">
          Couldn't load more apps.
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Retry
          </Button>
        </div>
      </Show>
      <Show
        when={
          props.catalog.query.hasNextPage &&
          !props.catalog.query.isFetching &&
          !props.catalog.query.isError
        }
      >
        <div ref={setSentinel} class="h-px" aria-hidden="true" />
      </Show>
    </>
  );
}

function CatalogRow(props: { entry: PipedreamCatalogEntryResponse }) {
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => props.entry,
    onConnected: (entry) => toast.success(`${entry.display_name} connected`),
  });
  const name = () => props.entry.display_name;

  return (
    <IntegrationListRow
      icon={
        <PipedreamConnectorIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
          class="size-5"
        />
      }
      name={name()}
      kind="mcp"
      description={connectorDescription(props.entry.app_slug, name())}
      categories={catalogCategories(props.entry)}
      status="available"
    >
      <ImportAction appSlug={props.entry.app_slug} name={name()} />
      <ConnectAction
        label="Connect"
        ariaLabel={busy() ? `Connecting ${name()}` : `Connect ${name()}`}
        loading={busy()}
        onClick={() => fireAndForget(connect(), 'connections-settings')}
      />
    </IntegrationListRow>
  );
}
