import { getIconConfig } from '@core/component/EntityIcon';
import { cn, Hotkey } from '@ui';
import { createEffect, For, on, Show } from 'solid-js';
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
  scrollSelectedIntoView?: boolean;
  detailsLeft?: boolean;
}) {
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
            {(section) => (
              <div role="group" aria-label={section.group.label} class="mb-1.5">
                <div class="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-ink-extra-muted uppercase">
                  {section.group.label}
                </div>
                <For each={section.items}>
                  {(item) => (
                    <button
                      type="button"
                      role="option"
                      id={props.itemId(item)}
                      data-create-option
                      aria-selected={selected() === item}
                      tabindex={-1}
                      class={cn(
                        'flex h-9 w-full scroll-m-2 items-center gap-2.5 rounded-md px-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-accent',
                        selected() === item
                          ? 'bg-ink/6 text-ink'
                          : 'text-ink-muted'
                      )}
                      onPointerMove={(event) => {
                        if (event.movementX || event.movementY)
                          props.onSelect(props.items.indexOf(item));
                      }}
                      onFocus={() => props.onSelect(props.items.indexOf(item))}
                      onClick={() => props.onChoose(item)}
                    >
                      <span
                        class={cn(
                          'size-4 shrink-0 [&_svg]:size-4',
                          getIconConfig(item.blockName).foreground
                        )}
                      >
                        <Dynamic component={item.icon} />
                      </span>
                      <span
                        class="min-w-0 flex-1 truncate text-sm font-medium"
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
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div
          class={cn(
            'min-w-0 flex-1 overflow-y-auto',
            props.detailsLeft
              ? 'border-r border-edge-divider'
              : 'border-l border-edge-divider'
          )}
        >
          <Show when={selected()}>
            {(item) => (
              <section
                aria-label={`${item().label} details`}
                class="flex min-h-full flex-col px-5 pt-6 pb-2 sm:px-8"
              >
                <div
                  class={cn(
                    'mb-5 flex size-18 shrink-0 items-center justify-center rounded-2xl shadow-[0_0_20px_0] shadow-current/[0.06]',
                    getIconConfig(item().blockName).background,
                    getIconConfig(item().blockName).foreground
                  )}
                >
                  <div class="size-9 [&_svg]:size-full">
                    <Dynamic component={item().icon} />
                  </div>
                </div>
                <h2 class="text-xl font-semibold">{item().label}</h2>
                <p class="mt-1 text-left text-sm leading-relaxed text-ink-muted">
                  {createMenuDetails(item())?.details ??
                    createMenuTagline(item())}
                </p>
                <div class="mt-auto flex shrink-0 items-center gap-3 pt-6">
                  <span
                    class={cn(
                      'flex h-9 items-center gap-1.5 text-xs text-ink-muted',
                      !props.showHotkeys && 'invisible'
                    )}
                  >
                    Shortcut
                    <Hotkey
                      token={item().hotkeyToken}
                      shortcut={shortcut(item())}
                      theme="subtle"
                      class="border-ink/12"
                    />
                  </span>
                </div>
              </section>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
