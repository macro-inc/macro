import { WorkspaceTexture } from '@app/components/WorkspaceTexture';
import { ENTITY_ICON_CONFIGS } from '@core/component/EntityIcon';
import { cn, Hotkey } from '@ui';
import { createEffect, createUniqueId, For, on, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type CreateMenuSection,
  createMenuDetails,
  createMenuTagline,
} from '../core/create-menu-details';
import type { CreatableBlock } from '../types';

export function LauncherDetails(props: {
  sections: CreateMenuSection[];
  items: CreatableBlock[];
  selectedIndex: number;
  itemId: (item: CreatableBlock) => string;
  onSelect: (index: number) => void;
  onChoose: (item: CreatableBlock) => void;
  showHotkeys?: boolean;
  shiftHeld?: boolean;
  scrollSelectedIntoView?: boolean;
  detailsLeft?: boolean;
}) {
  const textureId = createUniqueId();
  let list: HTMLDivElement | undefined;
  const selected = () => props.items[props.selectedIndex];
  const shortcut = (item: CreatableBlock) =>
    Array.isArray(item.hotkey) ? item.hotkey[0] : item.hotkey;

  createEffect(
    on(
      [
        () => props.selectedIndex,
        () => props.items,
        () => props.scrollSelectedIntoView,
      ],
      () => {
        if (props.scrollSelectedIntoView) {
          list
            ?.querySelector('[aria-selected="true"]')
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
    )
  );

  return (
    <div
      class={cn(
        'flex h-[min(25rem,calc(75vh-6rem))] min-h-0',
        props.detailsLeft && 'flex-row-reverse'
      )}
    >
      <Show
        when={props.items.length}
        fallback={
          <div
            role="status"
            class="flex flex-1 items-center justify-center text-sm text-ink-muted"
          >
            No matching create options
          </div>
        }
      >
        <div
          ref={list}
          role="listbox"
          aria-label="Create options"
          class="w-[38%] min-w-0 shrink-0 overflow-y-auto p-2 sm:w-64"
        >
          <For each={props.sections}>
            {(section, sectionIndex) => (
              <For each={section.items}>
                {(item, itemIndex) => {
                  const index = () =>
                    props.sections
                      .slice(0, sectionIndex())
                      .reduce(
                        (offset, entry) => offset + entry.items.length,
                        0
                      ) + itemIndex();
                  return (
                    <button
                      type="button"
                      role="option"
                      id={`${props.itemId(item)}-${section.group.id}`}
                      data-create-option
                      aria-selected={props.selectedIndex === index()}
                      tabindex={-1}
                      class={cn(
                        'flex h-8 w-full scroll-m-2 items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none',
                        props.selectedIndex === index()
                          ? 'bg-ink/[0.07] text-ink'
                          : 'text-ink-muted'
                      )}
                      onPointerMove={(event) => {
                        if (event.movementX || event.movementY)
                          props.onSelect(index());
                      }}
                      onFocus={() => props.onSelect(index())}
                      onClick={() => props.onChoose(item)}
                    >
                      <span
                        class={cn(
                          'size-4 shrink-0 transition-colors duration-100 motion-reduce:transition-none [&_svg]:size-4',
                          props.selectedIndex === index()
                            ? 'text-ink'
                            : 'text-ink-extra-muted'
                        )}
                      >
                        <Dynamic component={item.icon} />
                      </span>
                      <span
                        class="min-w-0 flex-1 truncate text-[13px] font-medium"
                        title={item.label}
                      >
                        {item.label}
                      </span>
                      <Show when={props.showHotkeys}>
                        <span class="rounded-md border border-ink/12 px-1.5 py-px text-xxs font-normal text-ink-muted">
                          <Hotkey
                            token={item.hotkeyToken}
                            shortcut={shortcut(item)}
                          />
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            )}
          </For>
        </div>
        <div
          class={cn(
            'relative isolate min-w-0 flex-1 overflow-hidden light-mode:text-ink',
            ENTITY_ICON_CONFIGS[selected()?.blockName ?? 'default'].foreground,
            props.detailsLeft
              ? 'border-r border-edge-divider'
              : 'border-l border-edge-divider'
          )}
        >
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 -z-10 opacity-65 light-mode:opacity-35"
            style={{
              background:
                'radial-gradient(ellipse at center, color-mix(in srgb, currentColor 14%, transparent), transparent 72%)',
            }}
          />
          <div class="pointer-events-none absolute inset-0 opacity-65 light-mode:opacity-20">
            <WorkspaceTexture accent="currentColor" filterId={textureId} />
          </div>
          <div class="relative h-full overflow-y-auto">
            <Show when={selected()}>
              {(item) => (
                <section
                  aria-label={`${item().label} details`}
                  class="flex min-h-full flex-col items-center justify-center px-5 py-6 text-center sm:px-7"
                >
                  <div class="mb-6 flex size-18 shrink-0 items-center justify-center rounded-[22px] dark-mode:glass bg-dialog bg-linear-145 from-ink/[0.06] to-transparent light-mode:bg-composer light-mode:bg-none light-mode:composer-shadow">
                    <div class="size-8 [&_svg]:size-full">
                      <Dynamic component={item().icon} />
                    </div>
                  </div>
                  <h2 class="text-xl font-semibold tracking-[-0.025em] text-ink">
                    {item().label}
                  </h2>
                  <p class="mt-2 max-w-[26rem] whitespace-pre-line text-center text-[13px] leading-relaxed text-ink-muted">
                    {createMenuDetails(item())?.details ??
                      createMenuTagline(item())}
                  </p>
                  <Show when={props.showHotkeys}>
                    <div class="mt-4 flex shrink-0 items-center gap-1.5 text-xs text-ink-extra-muted">
                      Shortcut
                      <Hotkey
                        shortcut="c"
                        theme="subtle"
                        class="border-ink/12"
                      />
                      then
                      <Hotkey
                        token={item().hotkeyToken}
                        shortcut={shortcut(item())}
                        theme="subtle"
                        class="border-ink/12"
                      />
                    </div>
                  </Show>
                </section>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
