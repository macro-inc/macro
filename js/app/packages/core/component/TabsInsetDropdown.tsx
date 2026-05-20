import { DropdownMenu as KDropdownMenu } from '@kobalte/core/dropdown-menu';
import CaretDown from '@phosphor/caret-down.svg';
import { cn, Layer } from '@ui';
import { createMemo, For, type JSX, splitProps } from 'solid-js';

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
    <KDropdownMenu placement="bottom-start" gutter={4}>
      <Layer depth={local.depth ?? 0}>
        <KDropdownMenu.Trigger
          disabled={local.disabled}
          class={cn(
            'relative flex items-center bg-surface rounded-lg p-0.5 ring ring-edge-muted cursor-default outline-none disabled:opacity-50',
            local.class
          )}
        >
          <Layer depth={2}>
            <span class="flex items-center px-2.5 py-1 text-xs font-medium ring ring-edge-muted ring-inset rounded-md bg-surface text-ink shadow-sm">
              {current()?.label ?? local.placeholder ?? ''}
            </span>
          </Layer>
          <span class="flex items-center justify-center px-1.5 text-ink-extra-muted">
            <CaretDown class="size-3" />
          </span>
        </KDropdownMenu.Trigger>
      </Layer>
      <KDropdownMenu.Portal>
        <Layer depth={local.depth ?? 2}>
          <KDropdownMenu.Content class="z-action-menu flex flex-col bg-surface rounded-lg p-0.5 ring ring-edge-muted shadow-lg min-w-32 outline-none">
            <For each={local.list}>
              {(item) => {
                const isActive = () => current()?.value === item.value;
                return (
                  <Layer depth={2}>
                    <KDropdownMenu.Item
                      class={cn(
                        'flex items-center px-2.5 py-2 text-xs font-medium ring-inset rounded-md text-ink-extra-muted hover:bg-hover hover:text-ink focus:bg-hover focus:text-ink outline-none',
                        {
                          'text-red font-bold': isActive(),
                        }
                      )}
                      onSelect={() => local.onChange?.(item.value)}
                    >
                      {item.label}
                    </KDropdownMenu.Item>
                  </Layer>
                );
              }}
            </For>
          </KDropdownMenu.Content>
        </Layer>
      </KDropdownMenu.Portal>
    </KDropdownMenu>
  );
};
