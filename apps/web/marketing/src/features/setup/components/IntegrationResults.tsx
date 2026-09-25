import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createMediaQuery } from '@solid-primitives/media';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Virtualizer } from 'virtua/solid';
import { onboardingIntegrationKind } from '../core/onboardingIntegrationCatalog';
import type { OnboardingIntegration } from '../core/onboardingIntegrations';
import { ConnectorIcon } from './ConnectorIcon';

/** A stable viewport shared by bundled tools, catalog search, and infinite results. */
export function IntegrationResults(props: {
  entries: readonly OnboardingIntegration[];
  selected: readonly OnboardingIntegration[];
  onToggle: (integration: OnboardingIntegration) => void;
  ref?: (element: HTMLDivElement) => void;
  canLoadMore?: boolean;
  onLoadMore?: () => void;
  children?: JSX.Element;
}) {
  const wide = createMediaQuery('(min-width: 640px)');
  const columns = () => (wide() ? 4 : 3);
  const [focusedId, setFocusedId] = createSignal<string>();
  let scroller!: HTMLDivElement;
  const entries = createMemo<readonly OnboardingIntegration[]>(
    (previous = []) => {
      const existing = new Map(previous.map((entry) => [entry.id, entry]));
      return props.entries.map((entry) => {
        const oldEntry = existing.get(entry.id);
        // Preserve buttons and keyboard focus, even when a page fills a partial row.
        return oldEntry?.name === entry.name &&
          oldEntry.iconUrl === entry.iconUrl
          ? oldEntry
          : entry;
      });
    }
  );
  const rows = createMemo(() =>
    Array.from(
      { length: Math.ceil(entries().length / columns()) },
      (_, index) => index
    )
  );
  const focusedRows = () => {
    const index = props.entries.findIndex((entry) => entry.id === focusedId());
    return index < 0 ? [] : [Math.floor(index / columns())];
  };
  const loadNearEnd = () => {
    if (
      props.canLoadMore &&
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 320
    ) {
      props.onLoadMore?.();
    }
  };
  createEffect(() => {
    entries();
    columns();
    if (!props.canLoadMore) return;
    // Recheck after layout, including pages whose entries were all filtered out.
    const frame = requestAnimationFrame(loadNearEnd);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <div
      ref={(element) => {
        scroller = element;
        props.ref?.(element);
      }}
      role="region"
      aria-label="Available integrations"
      tabindex="0"
      onScroll={loadNearEnd}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusedId(undefined);
        }
      }}
      class="h-[32rem] overflow-y-auto rounded-xl px-1 py-1 outline-none focus-visible:ring-1 focus-visible:ring-ink/30"
      style={{ 'scrollbar-gutter': 'stable' }}
    >
      <Virtualizer
        data={rows()}
        scrollRef={scroller}
        itemSize={172}
        bufferSize={300}
        keepMounted={focusedRows()}
      >
        {(row) => (
          <div class="grid grid-cols-3 gap-x-2 pb-5 sm:grid-cols-4">
            <For each={entries().slice(row * columns(), (row + 1) * columns())}>
              {(entry) => {
                const selected = () =>
                  props.selected.some((item) => item.id === entry.id);
                return (
                  <button
                    type="button"
                    aria-label={`${selected() ? 'Deselect' : 'Select'} ${entry.name}`}
                    aria-pressed={selected()}
                    onFocus={() => setFocusedId(entry.id)}
                    onClick={() => props.onToggle(entry)}
                    class="group flex min-w-0 flex-col items-center gap-3 rounded-2xl p-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ink/50"
                  >
                    <span
                      class="relative flex size-20 items-center justify-center rounded-[22px] bg-ink/5 transition-colors group-hover:bg-ink/10"
                      style={{
                        '--selected-green':
                          'color-mix(in oklab, var(--color-success) 72%, var(--color-surface))',
                      }}
                      classList={{
                        glass: !selected(),
                        'border-2 border-[var(--selected-green)]': selected(),
                      }}
                    >
                      <ConnectorIcon appSlug={entry.id} class="size-7" />
                      <span
                        class="absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border shadow-sm"
                        classList={{
                          'border-[var(--selected-green)] bg-[var(--selected-green)] text-ink ring-2 ring-surface':
                            selected(),
                          'border-edge bg-surface text-ink-muted': !selected(),
                        }}
                      >
                        <Show
                          when={selected()}
                          fallback={<PlusIcon class="size-3.5" />}
                        >
                          <CheckIcon class="size-3.5" />
                        </Show>
                      </span>
                    </span>
                    <span class="flex w-full flex-col gap-1">
                      <span class="w-full break-words text-xs font-medium">
                        {entry.name}
                      </span>
                      <span class="text-[11px] font-normal text-ink-extra-muted">
                        {onboardingIntegrationKind(entry.id)}
                      </span>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        )}
      </Virtualizer>
      {props.children}
    </div>
  );
}
