import CaretDown from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
import { createMemo, For, type JSX, Show, splitProps } from 'solid-js';

export type TabItem = {
  value: string;
  label: string | JSX.Element;
};

export type TabsInsetDropdownProps = {
  list: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  class?: string;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  placeholder?: string | JSX.Element;
};

export const TabsInsetDropdown = (props: TabsInsetDropdownProps) => {
  const [local] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'onChange',
    'disabled',
    'class',
    'depth',
    'placeholder',
  ]);

  const current = createMemo(() => {
    const v = local.value ?? local.defaultValue ?? local.list[0]?.value;
    return local.list.find((item) => item.value === v) ?? local.list[0];
  });

  return (
    <Dropdown placement="bottom-start" gutter={4}>
      <Dropdown.Trigger
        class={cn('bg-surface', local.class)}
        disabled={local.disabled}
        depth={local.depth ?? 2}
      >
        <span class="truncate">
          {current()?.label ?? local.placeholder ?? ''}
        </span>
        <CaretDown class="size-3 text-ink-extra-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content>
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
