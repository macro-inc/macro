import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Button, Layer } from '@ui';
import { createResource, createSignal, Show } from 'solid-js';
import { useExperimentalPowersDetails } from './experimental-powers-details-context';

/** Badge identifying Macro's built-in memory. */
export function CoreBadge() {
  return (
    <span class="inline-flex items-center gap-1 rounded-full border border-amber/25 bg-amber-bg px-2 py-0.5 font-mono text-xxs font-medium uppercase text-amber-ink">
      <SparkleIcon class="size-3" />
      Core
    </span>
  );
}

/** Markdown content for Macro's built-in memory. */
export function ExperimentalMemoryDetails() {
  const [memory] = createResource(() => cognitionApiServiceClient.getMemory());
  const memoryText = () => {
    const result = memory();
    return result?.isOk() ? result.value.memory.trim() : undefined;
  };

  return (
    <Show
      when={!memory.loading}
      fallback={
        <div class="flex flex-col gap-3 py-2">
          <div class="h-3 w-5/6 animate-pulse rounded-full bg-skeleton" />
          <div class="h-3 w-full animate-pulse rounded-full bg-skeleton" />
          <div class="h-3 w-3/4 animate-pulse rounded-full bg-skeleton" />
        </div>
      }
    >
      <Show
        when={memoryText()}
        fallback={
          <p class="py-3 text-sm leading-6 text-ink-muted">
            Macro is still building this memory. Check back soon.
          </p>
        }
      >
        {(text) => (
          <div class="select-text text-sm text-ink">
            <StaticMarkdown markdown={text()} />
          </div>
        )}
      </Show>
    </Show>
  );
}

/** Experimental memory cards controlled by the Powers details sidebar. */
export function ExperimentalMemoriesView() {
  const powersDetails = useExperimentalPowersDetails();
  const [search, setSearch] = createSignal('');
  const selected = () => powersDetails?.detail()?.kind === 'memory';
  const memoryMatchesSearch = () => {
    const query = search().trim().toLocaleLowerCase();
    return !query || 'your context macro core work preferences'.includes(query);
  };

  return (
    <Layer depth={2}>
      <main class="mx-2 mb-2 min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-10 pt-5 @max-[760px]/experimental-soup:mx-1 @max-[760px]/experimental-soup:px-3 @max-[480px]/experimental-soup:px-2">
        <div class="mb-4 flex h-9 w-full max-w-md items-center gap-2 rounded-full bg-ink/4 px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent/30">
          <MagnifyingGlassIcon class="size-3.5 shrink-0" />
          <input
            type="search"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search memories"
            class="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder"
          />
        </div>
        <div
          class="grid min-w-0 justify-items-start gap-3"
          style={{
            'grid-template-columns':
              'repeat(auto-fit, minmax(min(100%, 20rem), 20rem))',
          }}
        >
          <Show when={memoryMatchesSearch()}>
            <div
              class={`flex min-h-32 min-w-0 w-full flex-col overflow-hidden rounded-2xl border bg-lift transition-colors hover:border-amber/35 ${
                selected() ? 'border-amber/35 bg-active' : 'border-edge'
              }`}
              onClick={() => powersDetails?.select({ kind: 'memory' })}
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 flex-col items-start gap-2 px-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber/40"
              >
                <CoreBadge />
                <span class="min-w-0 truncate text-base font-semibold text-ink">
                  Your context
                </span>
                <p class="text-sm leading-5 text-ink-muted">
                  What Macro remembers about you, your work, and your
                  preferences.
                </p>
              </button>
              <div class="flex items-center justify-end px-3 pb-3">
                <Button
                  variant="ghost"
                  size="md"
                  class="h-9 rounded-full bg-ink/8 px-4 text-ink hover:bg-ink/12"
                  onClick={(event) => event.stopPropagation()}
                >
                  Edit
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </main>
    </Layer>
  );
}
