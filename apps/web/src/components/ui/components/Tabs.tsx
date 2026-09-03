import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import { For, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

export type TabItem = {
  value: string;
  label: string | JSX.Element;
};

export type TabsProps = {
  list: TabItem[];
  value?: string;
  defaultValue?: string;
  class?: string;
  itemClass?: string;
  labelClass?: string;
  fullWidth?: boolean;
} & Omit<SegmentedControlRootProps, 'defaultValue'>;

/**
 * Borderless tab switcher. No track chrome — a rounded pill slides behind
 * the active item.
 */
export const Tabs = (props: TabsProps) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
    'itemClass',
    'labelClass',
    'fullWidth',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn(
        'relative inline-flex h-8 items-center',
        local.fullWidth && 'flex w-full',
        local.class
      )}
    >
      <KSegmentedControl.Indicator class="pointer-events-none absolute top-0 left-0 z-0 rounded-xl border border-edge-muted bg-active transition-[transform,width,height] duration-50" />
      <For each={local.list}>
        {(item) => (
          <KSegmentedControl.Item
            value={item.value}
            disabled={local.disabled}
            class={cn(
              'relative z-1 rounded-full has-focus-visible:ring-2 has-focus-visible:ring-accent/20',
              local.fullWidth && 'flex-1',
              local.itemClass
            )}
          >
            <KSegmentedControl.ItemInput class="pointer-events-none absolute inset-0" />
            <KSegmentedControl.ItemLabel
              class={cn(
                'flex h-8 items-center px-4 text-xs font-medium rounded-full select-none',
                'text-ink-extra-muted hover:text-ink data-checked:text-ink',
                local.fullWidth && 'w-full justify-center',
                local.labelClass
              )}
            >
              {item.label}
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </KSegmentedControl>
  );
};
