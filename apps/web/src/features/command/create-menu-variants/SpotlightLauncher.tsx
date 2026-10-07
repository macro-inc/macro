import { TOKENS } from '@core/hotkey/tokens';
import { Button, cn, Hotkey } from '@ui';
import { For, Show } from 'solid-js';
import type { CreatableBlock } from '../types';
import { createMenuDetails, createMenuTagline } from './catalog';
import {
  CreateMenuEmpty,
  CreateMenuFooter,
  CreateMenuIcon,
  CreateMenuKey,
  CreateMenuSearch,
  CreateMenuStyles,
  createMenuAccent,
  createMenuTint,
} from './parts';
import {
  useVariantLauncher,
  type VariantLauncherController,
  type VariantLauncherProps,
} from './use-variant-launcher';

/**
 * Search-first: the cursor starts in the search field, a compact grouped list
 * sits on the left, and whatever is highlighted gets a large animated preview
 * on the right explaining what it is and what people make with it.
 */
export function SpotlightLauncher(props: VariantLauncherProps) {
  const c = useVariantLauncher(props, { autoFocusSearch: true });

  return (
    <div
      ref={c.setRootRef}
      tabindex={-1}
      class="elevated-surface create-menu-pane flex h-[min(34rem,80vh)] w-[54rem] max-w-[calc(100vw-16px)] flex-col overflow-hidden outline-none"
    >
      <CreateMenuStyles />
      <div class="flex items-center gap-3 border-b border-edge-muted/60 px-5 py-3.5">
        <CreateMenuSearch
          controller={c}
          class="text-base"
          placeholder="What do you want to create?"
        />
      </div>

      <Show
        when={c.sections().length > 0}
        fallback={
          <div class="flex-1">
            <CreateMenuEmpty query={c.query()} />
          </div>
        }
      >
        <div class="flex min-h-0 flex-1">
          <div class="w-full min-w-0 overflow-y-auto scrollbar-hidden p-2 sm:w-72 sm:shrink-0">
            <For each={c.sections()}>
              {(section) => (
                <div class="mb-1.5">
                  <div class="px-2.5 pt-2 pb-1 text-xxs font-medium tracking-wide text-ink-extra-muted uppercase">
                    {section.group.label}
                  </div>
                  <For each={section.items}>
                    {(item) => <SpotlightRow item={item} controller={c} />}
                  </For>
                </div>
              )}
            </For>
          </div>

          <div class="hidden min-w-0 flex-1 border-l border-edge-muted/60 bg-ink/[0.015] sm:flex">
            <Show when={c.selected()} keyed>
              {(item) => <SpotlightPreview item={item} controller={c} />}
            </Show>
          </div>
        </div>
      </Show>

      <CreateMenuFooter controller={c} />
    </div>
  );
}

function SpotlightRow(props: {
  item: CreatableBlock;
  controller: VariantLauncherController;
}) {
  const c = props.controller;
  const active = () => c.isSelected(props.item);

  return (
    <button
      type="button"
      data-launcher-index={c.indexOf(props.item)}
      class={cn(
        'flex h-9 w-full scroll-m-2 items-center gap-2.5 rounded-md px-2.5 text-left outline-none',
        active() ? 'bg-ink/6 text-ink' : 'text-ink-muted'
      )}
      onPointerMove={() => c.hover(props.item)}
      onClick={() => c.run(props.item)}
    >
      <div
        class={cn(
          'size-4 shrink-0 [&_svg]:size-4',
          active() ? createMenuAccent(props.item) : 'text-ink-extra-muted'
        )}
      >
        <CreateMenuIcon item={props.item} active={false} class="size-4" />
      </div>
      <span class="min-w-0 flex-1 truncate text-sm font-medium">
        {props.item.label}
      </span>
      <Show when={!c.searchFocused()}>
        <CreateMenuKey item={props.item} />
      </Show>
    </button>
  );
}

/** Keyed on the item, so it remounts and replays its entrance per selection. */
function SpotlightPreview(props: {
  item: CreatableBlock;
  controller: VariantLauncherController;
}) {
  const c = props.controller;
  const details = () => createMenuDetails(props.item);

  return (
    <div class="create-menu-fade-up flex w-full flex-col justify-center px-10 py-8">
      <div
        class={cn(
          'mb-6 flex size-24 items-center justify-center rounded-3xl',
          createMenuTint(props.item),
          createMenuAccent(props.item)
        )}
      >
        <CreateMenuIcon item={props.item} active class="size-12" />
      </div>

      <h2 class="text-2xl font-semibold text-ink">{props.item.label}</h2>
      <p class="mt-1 text-sm font-medium text-ink-muted">
        {createMenuTagline(props.item)}
      </p>
      <Show when={details()}>
        {(d) => (
          <>
            <p class="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
              {d().details}
            </p>
            <div class="mt-4 flex flex-wrap gap-1.5">
              <For each={d().examples}>
                {(example) => (
                  <span class="rounded-full border border-edge-muted px-2.5 py-0.5 text-xs text-ink-muted">
                    {example}
                  </span>
                )}
              </For>
            </div>
          </>
        )}
      </Show>

      <div class="mt-7 flex items-center gap-2">
        <Button
          variant="cta"
          size="sm"
          class="rounded-lg"
          onClick={() => c.run(props.item)}
        >
          Create {props.item.label.toLowerCase()}
        </Button>
        <span class="ml-2 flex items-center gap-1 text-xs text-ink-extra-muted">
          Shortcut
          <span class="rounded-md border border-edge-muted px-1.5 py-px text-xxs text-ink-muted">
            <Hotkey token={TOKENS.global.createCommand} />
          </span>
          then
          <CreateMenuKey item={props.item} />
        </span>
      </div>
    </div>
  );
}
