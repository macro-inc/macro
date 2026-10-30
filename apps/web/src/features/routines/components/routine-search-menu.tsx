import CheckIcon from '@icon/system/regular/check.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, type ButtonProps, cn } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Show,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * Where a step menu mounts: on the creator's dialog when inside one, so the
 * composer's scrolling panel can't clip it; the local scope otherwise.
 */
export function menuMount(trigger: HTMLElement | undefined) {
  return trigger?.closest<HTMLElement>('[role="dialog"]') ?? undefined;
}

export type SearchMenuItem = {
  key: string;
  label: string;
  /** More words that find it. */
  keywords?: string;
  icon?: Component<{ class?: string }>;
  /** Shown before the label instead of an icon, e.g. a tag's color. */
  swatch?: JSX.Element;
  /** AI steps take the accent. */
  ai?: boolean;
  /** Muted text at the end of the row. */
  hint?: string;
  /** A longer explanation, as the row's tooltip. */
  description?: string;
  selected?: boolean;
  onSelect(): void;
};

export type SearchMenuSection = {
  label?: string;
  items: SearchMenuItem[];
};

/**
 * A token or button that opens a searchable list of choices, grouped like a
 * menu. Arrow keys move between the search field and the choices.
 */
export function SearchMenu(props: {
  /** The trigger's accessible name. */
  label: string;
  trigger: JSX.Element;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  /** Placement only. */
  triggerClass?: string;
  title?: string;
  placeholder: string;
  sections: SearchMenuSection[];
  /** A choice made from the search text itself, e.g. a label by name. */
  fromQuery?: (query: string) => SearchMenuItem | undefined;
  /** Shown under the choices, e.g. why some are missing. */
  footer?: JSX.Element;
  empty?: string;
  width?: 'w-64' | 'w-72' | 'w-80';
  disabled?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let trigger: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const sections = () => {
    const words = query().trim().toLowerCase();
    return props.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(words)
        ),
      }))
      .filter((section) => section.items.length);
  };
  const extra = () => {
    const text = query().trim();
    return text ? props.fromQuery?.(text) : undefined;
  };
  const options = () =>
    list ? [...list.querySelectorAll<HTMLElement>('[data-search-option]')] : [];
  const select = (item: SearchMenuItem) => {
    item.onSelect();
    setOpen(false);
  };
  const changeOpen = (next: boolean) => {
    if (next) setQuery('');
    setOpen(next);
  };
  const move = (from: number, delta: number) => {
    const all = options();
    const index = from + delta;
    if (index < 0) input?.focus();
    else all[Math.min(index, all.length - 1)]?.focus();
  };
  return (
    <Popover
      open={open()}
      onOpenChange={changeOpen}
      placement="bottom-start"
      gutter={4}
    >
      <Popover.Trigger<ValidComponent>
        as={Button}
        ref={trigger}
        variant={props.triggerVariant ?? 'secondary'}
        size={props.triggerSize ?? 'sm'}
        class={props.triggerClass}
        aria-label={props.label}
        title={props.title}
        disabled={props.disabled}
      >
        {props.trigger}
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content
          class={cn(
            'menu-surface z-action-menu flex max-h-[min(30rem,var(--kb-popper-content-available-height))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl text-sm text-ink outline-none',
            props.width ?? 'w-72'
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input?.focus();
          }}
        >
          <div class="flex shrink-0 items-center gap-2 border-b border-edge-divider px-3 py-2">
            <SearchIcon class="size-4 shrink-0 text-ink-muted" />
            <input
              ref={input}
              type="text"
              aria-label={props.placeholder}
              placeholder={props.placeholder}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(-1, 1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  options()[0]?.click();
                }
              }}
              class="h-6 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-placeholder"
            />
          </div>
          <div
            ref={list}
            role="listbox"
            aria-label={props.label}
            class="min-h-0 overflow-y-auto overscroll-contain p-1.5"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const index = options().indexOf(
                document.activeElement as HTMLElement
              );
              move(index, event.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            <For each={sections()}>
              {(section) => (
                <div role="group" aria-label={section.label} class="pb-1">
                  <Show when={section.label}>
                    <p class="flex h-7 items-center px-2 text-xs text-ink-extra-muted">
                      {section.label}
                    </p>
                  </Show>
                  <For each={section.items}>
                    {(item) => <SearchMenuRow item={item} onSelect={select} />}
                  </For>
                </div>
              )}
            </For>
            <Show when={extra()}>
              {(item) => <SearchMenuRow item={item()} onSelect={select} />}
            </Show>
            <Show when={!sections().length && !extra()}>
              <p class="px-2 py-2 text-sm text-ink-muted">
                {props.empty ?? 'Nothing matches'}
              </p>
            </Show>
          </div>
          <Show when={props.footer && !query().trim()}>
            <div class="shrink-0 border-t border-edge-divider px-3 py-2 text-xs text-ink-muted">
              {props.footer}
            </div>
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function SearchMenuRow(props: {
  item: SearchMenuItem;
  onSelect(item: SearchMenuItem): void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.item.selected ?? false}
      data-search-option
      title={props.item.description}
      class="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-ink/5 focus-visible:bg-ink/5 touch:min-h-11"
      onClick={() => props.onSelect(props.item)}
    >
      <Show
        when={props.item.swatch}
        fallback={
          <Show when={props.item.icon}>
            {(icon) => (
              <Dynamic
                component={icon()}
                class={cn(
                  'size-4 shrink-0',
                  props.item.ai ? 'text-accent' : 'text-ink-muted'
                )}
              />
            )}
          </Show>
        }
      >
        {props.item.swatch}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.item.label}</span>
      <Show when={props.item.hint}>
        <span class="shrink-0 text-xs text-ink-muted">{props.item.hint}</span>
      </Show>
      <Show when={props.item.selected}>
        <CheckIcon class="size-3.5 shrink-0 text-ink-muted" />
      </Show>
    </button>
  );
}
