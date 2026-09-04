import CaretDown from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Dropdown, Layer } from '@ui';
import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';

export type TabItem = {
  label: string | JSX.Element;
  value: string;
};

export type TabGroup = {
  label: string;
  items: TabItem[];
};

export type TabsInsetDropdownProps = {
  placeholder?: string | JSX.Element;
  onChange?: (value: string) => void;
  depth?: 0 | 1 | 2 | 3 | 4;
  defaultValue?: string;
  disabled?: boolean;
  groups?: TabGroup[];
  list?: TabItem[];
  class?: string;
  value?: string;
};

const MENU_OPEN_MS = 120;

const scrollCurrentTabIntoView = (root: HTMLElement) => {
  const selected = root.querySelector<HTMLElement>('[data-current]');
  const menu = selected?.closest('[role="menu"]');
  if (!selected || !(menu instanceof HTMLElement)) return;

  menu.scrollTop = 0;
  selected.focus({ preventScroll: true });

  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;
  window.setTimeout(
    () => {
      if (!selected.isConnected) return;
      selected.scrollIntoView({
        block: 'end',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    },
    reduceMotion ? 0 : MENU_OPEN_MS
  );
};

export const TabsInsetDropdown = (props: TabsInsetDropdownProps) => {
  const [local] = splitProps(props, [
    'defaultValue',
    'placeholder',
    'onChange',
    'disabled',
    'groups',
    'class',
    'depth',
    'value',
    'list',
  ]);

  const displayGroups = createMemo(
    () => local.groups ?? [{ label: '', items: local.list ?? [] }]
  );

  const flatItems = createMemo(() =>
    displayGroups().flatMap((group) => group.items)
  );

  const current = createMemo(() => {
    const items = flatItems();
    const v = local.value ?? local.defaultValue ?? items[0]?.value;
    return items.find((item) => item.value === v) ?? items[0];
  });

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        class={cn(
          'not-disabled:hover:bg-surface active:bg-surface focus-visible:bg-surface',
          'h-auto p-0.5 rounded-lg border border-edge-muted bg-surface',
          local.class
        )}
        disabled={local.disabled}
        depth={local.depth ?? 0}
      >
        <Layer depth={2}>
          <span class="flex items-center px-2.5 py-1 text-xs font-medium ring ring-edge-muted ring-inset rounded-md bg-surface text-ink shadow-sm">
            {current()?.label ?? local.placeholder ?? ''}
          </span>
        </Layer>
        <span class="flex items-center justify-center px-1.5 text-ink-extra-muted">
          <CaretDown class="size-3" />
        </span>
      </Dropdown.Trigger>
      <Dropdown.Content
        class="max-h-[min(20rem,var(--kb-popper-content-available-height,70dvh))]"
        depth={local.depth ?? 2}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            scrollCurrentTabIntoView(event.currentTarget);
          }
        }}
      >
        <For each={displayGroups()}>
          {(group) => (
            <Dropdown.Group>
              <Show when={group.label}>
                <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
              </Show>
              <For each={group.items}>
                {(item) => {
                  const isActive = () => current()?.value === item.value;
                  return (
                    <Dropdown.Item
                      class={cn(
                        isActive() && 'text-ink font-semibold scroll-mb-16'
                      )}
                      data-current={isActive() ? '' : undefined}
                      onSelect={() => local.onChange?.(item.value)}
                    >
                      <span class="flex-1 truncate">{item.label}</span>
                      <Show when={isActive()}>
                        <CheckIcon class="size-3.5 text-accent" />
                      </Show>
                    </Dropdown.Item>
                  );
                }}
              </For>
            </Dropdown.Group>
          )}
        </For>
      </Dropdown.Content>
    </Dropdown>
  );
};
