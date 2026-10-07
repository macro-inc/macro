import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { CreatableBlock } from '../types';
import { createMenuTagline } from './catalog';
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
 * One outlined shelf per group — docs, visual, communicate, plan, AI — with
 * the group named on the left and its members as wide cards on the right, so
 * related things (tasks and projects, messages and channels) read as a set.
 */
export function ShelvesLauncher(props: VariantLauncherProps) {
  const c = useVariantLauncher(props);

  return (
    <div
      ref={c.setRootRef}
      tabindex={-1}
      class="elevated-surface create-menu-pane flex max-h-[82vh] w-[62rem] max-w-[calc(100vw-16px)] flex-col overflow-hidden outline-none"
    >
      <CreateMenuStyles />
      <div class="flex items-center gap-3 px-5 pt-4 pb-3">
        <CreateMenuSearch
          controller={c}
          class="rounded-lg border border-edge-muted bg-input px-3 py-2"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-5 pb-4">
        <Show
          when={c.sections().length > 0}
          fallback={<CreateMenuEmpty query={c.query()} />}
        >
          <div class="flex flex-col gap-2.5">
            <For each={c.sections()}>
              {(section) => (
                <section class="flex flex-col gap-2 rounded-xl border border-ink/8 bg-ink/[0.02] p-2 sm:flex-row sm:gap-0">
                  <div class="flex shrink-0 flex-col justify-center px-2 sm:w-32 sm:py-1">
                    <h2 class="text-sm font-medium text-ink">
                      {section.group.label}
                    </h2>
                    <Show when={section.group.tagline}>
                      <p class="text-xs leading-snug text-ink-extra-muted">
                        {section.group.tagline}
                      </p>
                    </Show>
                  </div>
                  <div class="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    <For each={section.items}>
                      {(item) => <ShelfCard item={item} controller={c} />}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
      </div>

      <CreateMenuFooter controller={c} />
    </div>
  );
}

function ShelfCard(props: {
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
        'flex min-h-[4.25rem] scroll-m-3 items-start gap-2.5 rounded-lg border p-2 text-left outline-none transition-[background-color,border-color,box-shadow] duration-150',
        active()
          ? 'border-ink/12 bg-ink/5 shadow-sm shadow-drop-shadow'
          : 'border-transparent'
      )}
      onPointerMove={() => c.hover(props.item)}
      onClick={() => c.run(props.item)}
    >
      <div
        class={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-click',
          createMenuTint(props.item),
          createMenuAccent(props.item),
          active() && 'scale-105'
        )}
      >
        <CreateMenuIcon item={props.item} active={active()} class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">
            {props.item.label}
          </span>
          <Show when={!c.searchFocused()}>
            <CreateMenuKey
              item={props.item}
              class={cn(
                'transition-opacity',
                active() ? 'opacity-100' : 'opacity-50'
              )}
            />
          </Show>
        </div>
        <div class="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-extra-muted">
          {createMenuTagline(props.item)}
        </div>
      </div>
    </button>
  );
}
