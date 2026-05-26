import CaretDown from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Dropdown, Layer } from '@ui';
import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';

export type TabItem = {
  label: string | JSX.Element;
  value: string;
};

export type TabsInsetDropdownProps = {
  placeholder?: string | JSX.Element;
  onChange?: (value: string) => void;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  defaultValue?: string;
  disabled?: boolean;
  list: TabItem[];
  class?: string;
  value?: string;
};

export const TabsInsetDropdown = (props: TabsInsetDropdownProps) => {
  const [local] = splitProps(props, [
    'defaultValue',
    'placeholder',
    'onChange',
    'disabled',
    'class',
    'depth',
    'value',
    'list',
  ]);

  const current = createMemo(() => {
    const v = local.value ?? local.defaultValue ?? local.list[0]?.value;
    return local.list.find((item) => item.value === v) ?? local.list[0];
  });

  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        class={cn(
          'not-disabled:hover:bg-surface active:bg-surface focus-visible:bg-surface',
          'h-auto p-0.5 rounded-lg border-0 ring ring-edge-muted bg-surface',
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
      <Dropdown.Content depth={local.depth ?? 2}>
        <Dropdown.Group>
          <For each={local.list}>
            {(item) => {
              const isActive = () => current()?.value === item.value;
              return (
                <Dropdown.Item
                  class={cn(isActive() && 'text-ink font-semibold')}
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
      </Dropdown.Content>
    </Dropdown>
  );
};
