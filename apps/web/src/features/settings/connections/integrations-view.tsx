import { SearchBar } from '@app/components/view-shell';
import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogSearch } from '@core/pipedream/catalog';
import {
  clearPendingConnectApp,
  pendingConnectApp,
} from '@core/pipedream/pendingConnect';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import { queryReadyGate } from '@queries/gate';
import {
  connectPipedreamApp,
  overlaidAppSlug,
  usePipedreamConnectedSlugs,
  usePipedreamOverlaysQuery,
} from '@queries/pipedream-connectors';
import { Button } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  Suspense,
} from 'solid-js';
import { SettingsPage } from '../primitives';
import { AddCustomMcpDialog } from './add-custom-mcp-dialog';
import { CatalogRows } from './catalog-rows';
import {
  aiAppItems,
  type IntegrationItemHosts,
  useAgentProviderItem,
  useEmailItems,
  useGithubItem,
  useGranolaItem,
} from './integration-items';
import {
  IntegrationItemRow,
  IntegrationsListHeader,
  matchesIntegration,
} from './integrations-list';
import { LeftoverRow, leftoverCategories } from './leftover-row';
import {
  type ConnectionsModel,
  capabilitiesFor,
  type Leftover,
  type ProviderId,
} from './model';
import { PipedreamAiProvider } from './PipedreamAiProvider';
import { PIPEDREAM_BROWSE_HIDDEN_SLUGS } from './provider-meta';
import { SlackChannelImportFlow } from './slack-channel-import/SlackChannelImportFlow';
import { useConnectionsModel } from './use-connections-model';
import {
  ConnectionsViewProvider,
  createConnectionsViewState,
  useConnectionsView,
} from './view-state';

type IntegrationsViewProps = IntegrationItemHosts & {
  initialProvider?: ProviderId;
};

export function IntegrationsView(props: IntegrationsViewProps) {
  const view = createConnectionsViewState({ provider: props.initialProvider });
  return (
    <ConnectionsViewProvider value={view}>
      <ConnectionsContent {...props} />
    </ConnectionsViewProvider>
  );
}

function ConnectionsContent(props: IntegrationsViewProps) {
  const { model, ready, error, partialError, retry } = useConnectionsModel();
  const view = useConnectionsView();
  const [importSlackChannels, setImportSlackChannels] = createSignal(false);
  // External entry points request a connector or the complete channel import flow.
  createEffect(
    on(pendingConnectApp, (requested) => {
      if (!requested) return;
      clearPendingConnectApp();
      if (requested.intent === 'import-slack-channels') {
        setImportSlackChannels(true);
        return;
      }
      fireAndForget(
        connectRequestedApp(requested.appSlug),
        'connections-settings'
      );
    })
  );
  async function connectRequestedApp(appSlug: string) {
    try {
      const outcome = await connectPipedreamApp({ appSlug });
      if (outcome === 'unsupported')
        toast.failure('Connectors are not available on this deployment');
    } catch {
      toast.failure(`Failed to connect ${appSlug}`);
    }
  }
  const slackConnected = () =>
    capabilitiesFor(model(), 'slack').some(
      (capability) =>
        capability.mechanism === 'pipedream' &&
        capability.status === 'connected'
    );

  return (
    <Show
      when={importSlackChannels()}
      fallback={
        <Show
          when={ready() && view.provider()}
          keyed
          fallback={
            <SettingsPage
              title="Integrations"
              bodyClass="mt-6 gap-4"
              contentClass="max-w-none px-8"
            >
              <Show when={error() || partialError()}>
                <div
                  role="status"
                  class="flex items-center gap-3 text-sm text-ink-muted"
                >
                  {error()
                    ? "Couldn't load agent tools."
                    : "Some connections couldn't be loaded."}
                  <Button variant="secondary" size="sm" onClick={retry}>
                    Retry
                  </Button>
                </div>
              </Show>
              <Show
                when={ready() || error()}
                fallback={
                  <p class="text-sm text-ink-muted">Loading integrations…</p>
                }
              >
                <Suspense>
                  <IntegrationsOverview
                    {...props}
                    model={model}
                    agentToolsAvailable={!error()}
                  />
                </Suspense>
              </Show>
            </SettingsPage>
          }
        >
          {(provider) => (
            <PipedreamAiProvider model={model()} provider={provider} />
          )}
        </Show>
      }
    >
      <Show
        when={ready()}
        fallback={
          <p class="text-sm text-ink-muted">Loading Slack connection…</p>
        }
      >
        <Suspense>
          <SlackChannelImportFlow
            connected={slackConnected()}
            onBack={() => setImportSlackChannels(false)}
          />
        </Suspense>
      </Show>
    </Show>
  );
}

function leftoverMatches(
  leftover: Leftover,
  overlaidAppSlug: string | undefined,
  query: string
): boolean {
  return matchesIntegration(
    {
      name: leftover.title,
      description: leftover.kind === 'native-mcp' ? leftover.subtitle : '',
      categories: leftoverCategories(leftover, overlaidAppSlug),
    },
    query
  );
}

/**
 * Every integration in one list: custom MCP servers first, then those in use,
 * then the rest, then the app catalog. One search filters all of them.
 */
function IntegrationsOverview(
  props: IntegrationsViewProps & {
    model: Accessor<ConnectionsModel>;
    /** False when connector records failed to load. */
    agentToolsAvailable: boolean;
  }
) {
  const [query, setQuery] = createSignal('');
  const [addingCustom, setAddingCustom] = createSignal(false);
  const view = useConnectionsView();
  const catalog = createPipedreamCatalogSearch(
    () => PIPEDREAM_BROWSE_HIDDEN_SLUGS
  );
  const search = (value: string) => {
    setQuery(value);
    catalog.onSearchInput(value);
  };

  const agentTools = [
    useAgentProviderItem(props.model, 'slack'),
    useAgentProviderItem(props.model, 'linear'),
    useAgentProviderItem(props.model, 'notion'),
  ];
  const items = [
    ...useEmailItems(props),
    useGithubItem(props.model),
    ...agentTools,
    useGranolaItem(),
    ...aiAppItems(props),
  ];
  // Agent tool rows need connector records; without them their state is unknown.
  const matching = () =>
    items.filter(
      (item) =>
        (props.agentToolsAvailable || !agentTools.includes(item)) &&
        matchesIntegration(item, query())
    );
  const inUse = () => matching().filter((item) => item.status !== 'available');
  const available = () =>
    matching().filter((item) => item.status === 'available');
  // Overlaid catalog apps connect as native MCP servers; show them as the app.
  const overlays = usePipedreamOverlaysQuery();
  const overlaidSlugFor = (leftover: Leftover) =>
    leftover.kind === 'native-mcp' && queryReadyGate(overlays)
      ? overlaidAppSlug(overlays.data, leftover.url)
      : undefined;
  // Until overlays load, a native server can't be told apart from a custom one;
  // hold those rows back so an overlaid app doesn't flash at the top.
  const leftovers = () =>
    props
      .model()
      .leftovers.filter(
        (row) =>
          !(row.kind === 'native-mcp' && overlays.isPlaceholderData) &&
          leftoverMatches(row, overlaidSlugFor(row), query())
      );
  // Servers the user added themselves lead the list.
  const isCustom = (leftover: Leftover) =>
    leftover.kind === 'native-mcp' && !overlaidSlugFor(leftover);
  const customLeftovers = () => leftovers().filter(isCustom);
  const otherLeftovers = () =>
    leftovers().filter((leftover) => !isCustom(leftover));

  // Includes overlaid apps, which are connected as native MCP servers.
  const connected = usePipedreamConnectedSlugs();
  const alreadyHave = createMemo(() => {
    const slugs = new Set<string>(connected.slugs());
    for (const row of props.model().capabilities) {
      if (row.status !== 'not-connected') slugs.add(row.provider);
    }
    for (const leftover of props.model().leftovers) {
      if (leftover.kind === 'pipedream') slugs.add(leftover.appSlug);
    }
    return slugs;
  });
  const catalogEntries = createMemo(() =>
    props.agentToolsAvailable
      ? catalog.entries().filter(
          (entry) =>
            !alreadyHave().has(entry.app_slug) &&
            matchesIntegration(
              {
                name: entry.display_name,
                description: `${entry.description ?? ''} ${entry.app_slug}`,
                categories: entry.categories ?? [],
              },
              query()
            )
        )
      : []
  );
  const nothingMatches = () =>
    matching().length === 0 &&
    leftovers().length === 0 &&
    catalogEntries().length === 0 &&
    !catalog.query.isFetching;

  return (
    <>
      <div class="flex items-center gap-2">
        <SearchBar
          size="sm"
          label="Search integrations"
          placeholder="Search integrations"
          value={query()}
          onValueChange={search}
          onEscape={() => search('')}
          class="min-w-0 flex-1"
        />
        <Show when={props.agentToolsAvailable}>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setAddingCustom(true)}
          >
            <PlusIcon class="size-4" /> Add custom
          </Button>
        </Show>
      </div>
      <div
        role="table"
        aria-label="Integrations"
        class="@container/integrations -mx-3 flex min-w-0 flex-col"
      >
        <IntegrationsListHeader />
        <div
          role="rowgroup"
          class="flex flex-col [&>[role=row]+[role=row]]:border-t [&>[role=row]+[role=row]]:border-ink/5"
        >
          <For each={customLeftovers()}>
            {(leftover) => <LeftoverRow leftover={leftover} />}
          </For>
          <For each={inUse()}>
            {(item) => <IntegrationItemRow item={item} />}
          </For>
          <For each={otherLeftovers()}>
            {(leftover) => (
              <LeftoverRow
                leftover={leftover}
                overlaidAppSlug={overlaidSlugFor(leftover)}
              />
            )}
          </For>
          <For each={available()}>
            {(item) => <IntegrationItemRow item={item} />}
          </For>
          <Show when={props.agentToolsAvailable}>
            <CatalogRows catalog={catalog} entries={catalogEntries} />
          </Show>
        </div>
        <Show when={nothingMatches()}>
          <p class="px-3 py-6 text-sm text-ink-muted">
            No integrations match “{query().trim()}”.
          </p>
        </Show>
      </div>
      <AddCustomMcpDialog
        open={addingCustom()}
        onOpenChange={setAddingCustom}
        onAdded={view.showOverview}
      />
    </>
  );
}
