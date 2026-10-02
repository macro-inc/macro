import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import {
  createPipedreamCatalogConnect,
  createPipedreamCatalogSearch,
} from '@core/pipedream/catalog';
import CheckIcon from '@phosphor/check.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { usePipedreamConnectedSlugs } from '@queries/pipedream-connectors';
import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';
import { createSignal, For, Show } from 'solid-js';
import { ContinueButton } from '../components/controls';

/** Uses the same searchable, paginated catalog and hosted connection flow as Settings. */
export function ToolsStep(props: { onContinue: () => void }) {
  const catalog = createPipedreamCatalogSearch(() => new Set<string>());
  const [connecting, setConnecting] = createSignal(false);
  const connected = usePipedreamConnectedSlugs({ refetchInterval: 5000 });
  return (
    <div class="flex flex-col gap-7">
      <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-5 py-4 shadow-sm focus-within:ring-1 focus-within:ring-ink/30">
        <SearchIcon aria-hidden="true" class="size-5 shrink-0 text-ink/35" />
        <input
          type="search"
          aria-label="Search integrations and MCPs"
          placeholder="Search integrations and MCPs"
          value={catalog.searchInput()}
          onInput={(event) => catalog.onSearchInput(event.currentTarget.value)}
          class="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-placeholder"
        />
      </label>
      <div
        role="region"
        aria-label="Available integrations"
        tabindex="0"
        class="h-[32rem] overflow-y-auto rounded-xl px-1 py-1 outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
        style={{ 'scrollbar-gutter': 'stable' }}
      >
        <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
          <For each={catalog.entries()}>
            {(entry) => (
              <ToolTile
                entry={entry}
                disabled={connecting() || !connected.ready()}
                onBusy={setConnecting}
                connected={connected.slugs().has(entry.app_slug)}
              />
            )}
          </For>
        </div>
        <Show when={catalog.query.isError}>
          <p role="alert" class="py-6 text-center text-sm text-ink-muted">
            Couldn't load integrations.{' '}
            <button
              type="button"
              class="underline"
              onClick={() => void catalog.query.refetch()}
            >
              Try again
            </button>
          </p>
        </Show>
        <Show when={catalog.query.isFetching}>
          <p role="status" class="py-6 text-center text-sm text-ink-muted">
            Loading integrations…
          </p>
        </Show>
        <Show
          when={
            !catalog.query.isFetching &&
            !catalog.query.isError &&
            catalog.entries().length === 0
          }
        >
          <p class="py-6 text-center text-sm text-ink-muted">
            No integrations match “{catalog.searchInput()}”. Try another name.
          </p>
        </Show>
        <Show when={catalog.query.hasNextPage}>
          <button
            type="button"
            disabled={catalog.query.isFetching}
            onClick={() => void catalog.query.fetchNextPage()}
            class="mx-auto block rounded-full border border-edge px-4 py-2 text-sm text-ink-muted disabled:opacity-40"
          >
            Load more
          </button>
        </Show>
      </div>
      <ContinueButton disabled={connecting()} onClick={props.onContinue} />
    </div>
  );
}

function ToolTile(props: {
  entry: PipedreamCatalogEntryResponse;
  connected: boolean;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const { connect, busy } = createPipedreamCatalogConnect({
    entry: () => props.entry,
  });
  return (
    <button
      type="button"
      aria-label={`${props.connected ? 'Connected to' : busy() ? 'Connecting' : 'Connect'} ${props.entry.display_name}`}
      aria-busy={busy()}
      disabled={props.disabled || busy() || props.connected}
      onClick={() => {
        const run = async () => {
          props.onBusy(true);
          try {
            await connect();
          } finally {
            props.onBusy(false);
          }
        };
        void run();
      }}
      class="group flex min-w-0 flex-col items-center gap-3 rounded-2xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
    >
      <span
        class="relative flex size-20 items-center justify-center rounded-[22px] bg-ink/5 transition-colors group-hover:bg-ink/10"
        classList={{
          glass: !props.connected,
          'border-2 border-success': props.connected,
        }}
      >
        <PipedreamConnectorIcon
          appSlug={props.entry.app_slug}
          iconUrl={props.entry.icon_url}
          class="size-7"
        />
        <span
          class="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border shadow-sm"
          classList={{
            'border-success bg-success text-ink ring-2 ring-surface':
              props.connected,
            'border-edge bg-surface text-ink-muted': !props.connected,
          }}
        >
          <Show
            when={!busy()}
            fallback={<SpinnerIcon class="size-3.5 animate-spin" />}
          >
            <Show
              when={props.connected}
              fallback={<PlusIcon class="size-3.5" />}
            >
              <CheckIcon class="size-3.5" />
            </Show>
          </Show>
        </span>
      </span>
      <span class="flex w-full flex-col gap-1">
        <span class="w-full break-words text-xs font-medium">
          {props.entry.display_name}
        </span>
        <span class="text-[11px] font-normal text-ink-extra-muted">
          {props.connected ? 'Connected' : 'Integration'}
        </span>
      </span>
    </button>
  );
}
