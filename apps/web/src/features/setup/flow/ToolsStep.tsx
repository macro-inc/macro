import {
  FEATURED_MCP_SERVERS,
  pipedreamAppAvailableInEnv,
} from '@core/component/AI/constant/mcpServers';
import { createPipedreamCatalogSearch } from '@core/pipedream/catalog';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createMemo, createSignal, Show } from 'solid-js';
import { IntegrationResults } from '../components/IntegrationResults';
import { onboardingIntegrationEntries } from '../core/onboardingIntegrationCatalog';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import {
  ONBOARDING_CONNECTORS,
  type OnboardingConnectorServerName,
} from './onboardingConnectorConfig';
import { ContinueButton } from './shared';

export function ToolsStep(props: {
  preview?: boolean;
  connectorNames: readonly OnboardingConnectorServerName[];
  selected: readonly OnboardingIntegration[];
  onSelectionChange: (items: OnboardingIntegration[]) => void;
  onContinue: () => void;
}) {
  const pipedream = props.preview ? () => true : usePipedreamMcpFlag();
  const hiddenSlugs = () =>
    new Set(
      ONBOARDING_CONNECTORS.filter(
        (entry) =>
          !props.connectorNames.includes(entry.serverName) ||
          !pipedreamAppAvailableInEnv(entry.key)
      ).map((entry) => entry.key)
    );
  const toggle = (integration: OnboardingIntegration) => {
    props.onSelectionChange(
      props.selected.some((item) => item.id === integration.id)
        ? props.selected.filter((item) => item.id !== integration.id)
        : [...props.selected, integration]
    );
  };
  return (
    <div class="flex flex-col gap-7">
      <Show
        when={pipedream()}
        fallback={
          <FeaturedTools
            hiddenSlugs={hiddenSlugs()}
            selected={props.selected}
            onToggle={toggle}
          />
        }
      >
        <CatalogTools
          preview={props.preview}
          hiddenSlugs={hiddenSlugs()}
          selected={props.selected}
          onToggle={toggle}
        />
      </Show>
      <ContinueButton
        label={
          props.selected.length
            ? `Continue with ${props.selected.length} integration${props.selected.length === 1 ? '' : 's'}`
            : 'Continue'
        }
        onClick={props.onContinue}
      />
    </div>
  );
}

function ToolSearch(props: {
  value: string;
  onInput: (value: string) => void;
}) {
  return (
    <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-5 py-4 shadow-sm focus-within:ring-1 focus-within:ring-ink/30">
      <SearchIcon aria-hidden="true" class="size-5 shrink-0 text-ink/35" />
      <input
        type="search"
        aria-label="Search integrations and MCPs"
        placeholder="Search integrations and MCPs"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-placeholder"
      />
    </label>
  );
}

interface PickerProps {
  hiddenSlugs: ReadonlySet<string>;
  selected: readonly OnboardingIntegration[];
  onToggle: (integration: OnboardingIntegration) => void;
}

const featuredIntegrations: OnboardingIntegration[] = FEATURED_MCP_SERVERS.map(
  (server) => ({ id: server.app_slug, name: server.server_name })
);

function FeaturedTools(props: PickerProps) {
  const [search, setSearch] = createSignal('');
  const entries = () =>
    onboardingIntegrationEntries(
      featuredIntegrations,
      [],
      props.hiddenSlugs,
      search()
    );
  return (
    <div class="flex flex-col gap-6">
      <ToolSearch value={search()} onInput={setSearch} />
      <IntegrationResults
        entries={entries()}
        selected={props.selected}
        onToggle={props.onToggle}
      >
        <Show when={!entries().length}>
          <p class="py-6 text-center text-sm text-ink-muted">
            No integrations match “{search()}”. Try another name.
          </p>
        </Show>
      </IntegrationResults>
    </div>
  );
}

function CatalogTools(props: PickerProps & { preview?: boolean }) {
  const catalog = createPipedreamCatalogSearch(() => props.hiddenSlugs);
  let results: HTMLDivElement | undefined;
  const entries = createMemo(() =>
    onboardingIntegrationEntries(
      featuredIntegrations,
      (catalog.query.isSuccess || catalog.query.isFetchNextPageError
        ? catalog.entries()
        : []
      ).map((entry) => ({
        id: entry.app_slug,
        name: entry.display_name,
        iconUrl: entry.icon_url ?? undefined,
      })),
      props.hiddenSlugs,
      catalog.searchInput()
    )
  );
  const canLoadMore = () =>
    !!catalog.query.hasNextPage &&
    !catalog.query.isFetching &&
    !catalog.query.isError &&
    !catalog.query.isPlaceholderData &&
    catalog.searchInput().trim() === catalog.search().trim();
  let loadingMore = false;
  const loadMore = async () => {
    if (loadingMore || !canLoadMore()) return;
    loadingMore = true;
    try {
      await catalog.query.fetchNextPage();
    } finally {
      loadingMore = false;
    }
  };
  return (
    <div class="flex flex-col gap-6">
      <ToolSearch
        value={catalog.searchInput()}
        onInput={(value) => {
          catalog.onSearchInput(value);
          results?.scrollTo({ top: 0 });
        }}
      />
      <IntegrationResults
        ref={(el) => {
          results = el;
        }}
        entries={entries()}
        selected={props.selected}
        onToggle={props.onToggle}
        canLoadMore={canLoadMore()}
        onLoadMore={loadMore}
      >
        <Show when={catalog.query.isError}>
          <div class="flex flex-col items-center gap-3 py-6 text-center text-sm text-ink-muted">
            <p>Couldn’t load the connector catalog.</p>
            <Show when={props.preview}>
              <a href="/app/login" class="underline underline-offset-4">
                Sign in to browse all Pipedream connectors
              </a>
            </Show>
            <button
              type="button"
              onClick={() =>
                void (catalog.query.isFetchNextPageError
                  ? catalog.query.fetchNextPage()
                  : catalog.query.refetch())
              }
              class="underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        </Show>
        <Show when={catalog.query.isFetching}>
          <p role="status" class="text-center text-xs text-ink-muted">
            Finding integrations…
          </p>
        </Show>
        <Show
          when={
            !catalog.query.isError &&
            !catalog.query.isFetching &&
            !entries().length
          }
        >
          <p class="py-6 text-center text-sm text-ink-muted">
            No integrations found. Try another name.
          </p>
        </Show>
      </IntegrationResults>
    </div>
  );
}
