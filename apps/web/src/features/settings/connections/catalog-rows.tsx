import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { toast } from '@core/component/Toast/Toast';
import { ConnectorIcon } from '@core/connectors/ConnectorIcon';
import { createConnectAction } from '@core/connectors/connect-action';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import type { CatalogApp, ConnectorCatalogSearch } from '@queries/connectors';
import { Button } from '@ui';
import { type Accessor, createSignal, For, Show } from 'solid-js';
import { ConnectAction } from '../integration-ui';
import { connectorDescription, ImportAction } from './import-action';
import { IntegrationListRow } from './integrations-list';
import { OrgSetupNote } from './org-setup-note';

/** The directory's categories for an app, at most two. */
function catalogCategories(entry: CatalogApp): string[] {
  return (entry.categories ?? [])
    .map((category) => category.trim())
    .filter(Boolean)
    .slice(0, 2);
}

/** Catalog apps not yet connected, loading more as the list scrolls. */
export function CatalogRows(props: {
  catalog: ConnectorCatalogSearch;
  entries: Accessor<CatalogApp[]>;
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

function CatalogRow(props: { entry: CatalogApp }) {
  const name = () => props.entry.name;
  const { connect, busy } = createConnectAction({
    key: () => props.entry.key,
    name,
    onConnected: () => toast.success(`${name()} connected`),
  });

  return (
    <IntegrationListRow
      icon={
        <ConnectorIcon
          appSlug={props.entry.slug}
          iconUrl={props.entry.iconUrl}
          class="size-5"
        />
      }
      name={name()}
      kind="mcp"
      description={connectorDescription(props.entry.slug, name())}
      note={
        <Show when={props.entry.orgSetup}>
          {(setup) => <OrgSetupNote setup={setup()} />}
        </Show>
      }
      categories={catalogCategories(props.entry)}
      status="available"
    >
      <ImportAction appSlug={props.entry.slug} name={name()} />
      <ConnectAction
        label="Connect"
        ariaLabel={busy() ? `Connecting ${name()}` : `Connect ${name()}`}
        loading={busy()}
        onClick={() => fireAndForget(connect(), 'connections-settings')}
      />
    </IntegrationListRow>
  );
}
