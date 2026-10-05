import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createSignal, For, Show } from 'solid-js';
import { ContinueButton } from '../components/controls';
import { ToolTile } from '../components/tool-tile';
import { type Tool, useOnboardingContext } from '../context/onboarding-context';

/** Uses the same searchable, paginated catalog and hosted connection flow as Settings. */
export function ToolsStep(props: { onContinue: () => void }) {
  const context = useOnboardingContext();
  const catalog = context.createToolCatalog();
  const connected = context.createConnectedTools();
  const [busy, setBusy] = createSignal<string>();

  const connect = async (tool: Tool) => {
    if (busy()) return;
    setBusy(tool.slug);
    try {
      await context.connectTool(tool);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div class="flex flex-col gap-7">
      <label class="flex items-center gap-3 rounded-full border border-edge bg-input px-5 py-4 shadow-sm focus-within:ring-1 focus-within:ring-ink/30">
        <SearchIcon aria-hidden="true" class="size-5 shrink-0 text-ink/35" />
        <input
          type="search"
          aria-label="Search integrations and MCPs"
          placeholder="Search integrations and MCPs"
          value={catalog.search()}
          onInput={(event) => catalog.setSearch(event.currentTarget.value)}
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
            {(tool) => (
              <ToolTile
                tool={tool}
                busy={busy() === tool.slug}
                disabled={busy() !== undefined || connected() === undefined}
                connected={connected()?.has(tool.slug) ?? false}
                onConnect={() => void connect(tool)}
              />
            )}
          </For>
        </div>
        <Show when={catalog.failed()}>
          <p role="alert" class="py-6 text-center text-sm text-ink-muted">
            Couldn't load integrations.{' '}
            <button type="button" class="underline" onClick={catalog.retry}>
              Try again
            </button>
          </p>
        </Show>
        <Show when={catalog.fetching()}>
          <p role="status" class="py-6 text-center text-sm text-ink-muted">
            Loading integrations…
          </p>
        </Show>
        <Show
          when={
            !catalog.fetching() &&
            !catalog.failed() &&
            catalog.entries().length === 0
          }
        >
          <p class="py-6 text-center text-sm text-ink-muted">
            No integrations match “{catalog.search()}”. Try another name.
          </p>
        </Show>
        <Show when={catalog.hasMore()}>
          <button
            type="button"
            disabled={catalog.fetching()}
            onClick={catalog.loadMore}
            class="mx-auto block rounded-full border border-edge px-4 py-2 text-sm text-ink-muted disabled:opacity-40"
          >
            Load more
          </button>
        </Show>
      </div>
      <ContinueButton
        disabled={busy() !== undefined}
        onClick={props.onContinue}
      />
    </div>
  );
}
