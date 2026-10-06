/**
 * Picks a component from the file (instance swap properties, "Swap
 * instance"): preferred components first, then every component, with a
 * search field. Opens beside the design panel.
 */

import type { NodeRef } from '@core/fig-engine/design-types';
import type { ComponentInfo } from '@core/fig-engine/types';
import { Popover } from '@kobalte/core/popover';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import { Layer } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { componentLabel, swapChoices } from '../core/design-system';

function Choice(props: {
  component: ComponentInfo;
  current: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-ink hover:bg-hover"
      classList={{ 'bg-hover': props.current }}
      data-testid="fig-component-choice"
      onClick={() => props.onPick()}
    >
      <DiamondsFour class="size-3.5 shrink-0 text-accent" />
      <span class="truncate">{componentLabel(props.component)}</span>
    </button>
  );
}

export function ComponentPicker(props: {
  /** The trigger's content. */
  children: JSX.Element;
  label: string;
  testId?: string;
  class?: string;
  disabled?: boolean;
  components: readonly ComponentInfo[];
  preferred?: readonly NodeRef[];
  current?: string | null;
  onPick: (component: ComponentInfo) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const choices = () =>
    swapChoices(props.components, props.preferred ?? [], query());
  const pick = (c: ComponentInfo) => {
    setOpen(false);
    props.onPick(c);
  };
  return (
    <Popover
      placement="left-start"
      gutter={40}
      open={open()}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <Popover.Trigger
        aria-label={props.label}
        title={props.label}
        data-testid={props.testId}
        disabled={props.disabled}
        class={props.class}
      >
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Layer depth={3}>
          <Popover.Content
            class="fig-editor-theme z-modal flex max-h-96 w-64 flex-col rounded-xl border border-edge-muted bg-menu p-2 text-xs shadow-xl outline-none"
            aria-label={props.label}
            data-testid="fig-component-picker"
            onKeyDown={(e: KeyboardEvent) => {
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
            }}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          >
            <input
              class="mb-2 rounded-md bg-input px-2 py-1 text-ink outline-none placeholder:text-ink-placeholder"
              placeholder="Search components"
              data-testid="fig-component-search"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            <div class="min-h-0 flex-1 overflow-y-auto">
              <Show when={choices().preferred.length > 0}>
                <div class="px-2 py-1 font-semibold text-ink-muted">
                  Preferred
                </div>
                <For each={choices().preferred}>
                  {(c) => (
                    <Choice
                      component={c}
                      current={c.id === props.current}
                      onPick={() => pick(c)}
                    />
                  )}
                </For>
                <div class="px-2 py-1 font-semibold text-ink-muted">
                  All components
                </div>
              </Show>
              <For
                each={choices().others}
                fallback={
                  <p class="px-2 py-1 text-ink-muted">No components found.</p>
                }
              >
                {(c) => (
                  <Choice
                    component={c}
                    current={c.id === props.current}
                    onPick={() => pick(c)}
                  />
                )}
              </For>
            </div>
          </Popover.Content>
        </Layer>
      </Popover.Portal>
    </Popover>
  );
}
