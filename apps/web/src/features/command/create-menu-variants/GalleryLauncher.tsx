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
} from './parts';
import {
  useVariantLauncher,
  type VariantLauncherController,
  type VariantLauncherProps,
} from './use-variant-launcher';

/**
 * The old centered create menu, brought back: big tiles whose icons animate
 * on hover, now grouped and searchable, with a line under each title saying
 * what the thing is.
 */
export function GalleryLauncher(props: VariantLauncherProps) {
  const c = useVariantLauncher(props);

  return (
    <div
      ref={c.setRootRef}
      tabindex={-1}
      class="elevated-surface create-menu-pane flex max-h-[80vh] w-[54rem] max-w-[calc(100vw-16px)] flex-col overflow-hidden outline-none"
    >
      <CreateMenuStyles />
      <div class="flex items-center gap-3 border-b border-edge-muted/60 px-5 py-3.5">
        <CreateMenuSearch controller={c} class="text-base" />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden px-5 pt-4 pb-5">
        <Show
          when={c.sections().length > 0}
          fallback={<CreateMenuEmpty query={c.query()} />}
        >
          <div class="flex flex-col gap-4">
            <For each={c.sections()}>
              {(section) => (
                <section>
                  <div class="mb-2 flex items-baseline gap-2 px-0.5">
                    <h2 class="text-xs font-medium text-ink-muted">
                      {section.group.label}
                    </h2>
                    <span class="text-xs text-ink-extra-muted">
                      {section.group.tagline}
                    </span>
                  </div>
                  <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <For each={section.items}>
                      {(item) => <GalleryTile item={item} controller={c} />}
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

function GalleryTile(props: {
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
        'relative isolate flex min-h-36 scroll-m-4 flex-col items-center rounded-lg border bg-surface px-3 pt-7 pb-3.5 text-center outline-none',
        'transition-[transform,box-shadow,border-color] duration-200 ease-click',
        active()
          ? '-translate-y-1 border-ink/15 bg-ink/3 shadow-md shadow-drop-shadow'
          : 'border-ink/8 shadow-xs shadow-drop-shadow/40'
      )}
      onPointerMove={() => c.hover(props.item)}
      onClick={() => c.run(props.item)}
    >
      <Show when={!c.searchFocused()}>
        <CreateMenuKey item={props.item} class="absolute top-2 left-2" />
      </Show>
      <div
        class={cn(
          'absolute top-2.5 right-2.5 size-2 rounded-[2px] border border-ink/20 transition-colors duration-200',
          createMenuAccent(props.item)
        )}
        style={{ background: active() ? 'currentColor' : 'transparent' }}
      />

      <CreateMenuIcon
        item={props.item}
        active={active()}
        class={cn(
          'size-10 transition-[transform,color] duration-200 ease-out',
          active()
            ? cn('scale-110', createMenuAccent(props.item))
            : 'text-ink-extra-muted'
        )}
      />

      <div
        class={cn(
          'mt-3 text-sm font-medium transition-colors',
          active() ? 'text-ink' : 'text-ink-muted'
        )}
      >
        {props.item.label}
      </div>
      <div class="mt-1 line-clamp-2 text-xs leading-snug text-ink-extra-muted">
        {createMenuTagline(props.item)}
      </div>
    </button>
  );
}
