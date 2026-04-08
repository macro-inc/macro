import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import {
  type JSX,
  createEffect,
  createSignal,
  For,
  splitProps,
} from 'solid-js';
import { cn } from '@ui/utils/classname';

export type TabItem = {
  value: string;
  label: string | JSX.Element;
};

export const Tabs = (
  props: {
    list: TabItem[];
    value?: string;
    defaultValue?: string;
    indicatorPosition?: 'top' | 'bottom';
    class?: string;
  } & Omit<SegmentedControlRootProps, 'defaultValue'>
) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'indicatorPosition',
    'class',
  ]);

  let listRef!: HTMLDivElement;
  const itemRefs: HTMLElement[] = [];

  const [indicatorStyle, setIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });

  const updateIndicatorPosition = (element: HTMLElement) => {
    if (!listRef || !element) return;
    const listRect = listRef.getBoundingClientRect();
    const tabRect = element.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - listRect.left + listRef.scrollLeft,
      width: tabRect.width,
    });
  };

  createEffect(() => {
    const val = local.value ?? local.defaultValue ?? local.list[0]?.value;
    const idx = local.list.findIndex((t) => t.value === val);
    if (idx >= 0 && itemRefs[idx]) updateIndicatorPosition(itemRefs[idx]);
  });

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full', local.class)}
    >
      <div ref={listRef} class="relative flex items-center h-full">
        <For each={local.list}>
          {(item, i) => (
            <KSegmentedControl.Item
              value={item.value}
              disabled={local.disabled}
              ref={(el) => {
                itemRefs[i()] = el;
              }}
            >
              <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
              <KSegmentedControl.ItemLabel
                class={cn(
                  'flex items-center px-2 py-1 text-sm font-medium',
                  'text-ink-extra-muted',
                  'data-[checked]:text-accent hover:text-accent'
                )}
                onPointerDown={() => rootProps.onChange?.(item.value)}
              >
                {item.label}
              </KSegmentedControl.ItemLabel>
            </KSegmentedControl.Item>
          )}
        </For>
        <div
          data-indicator
          class={cn(
            'absolute h-[2px] bg-accent transition-[left,width] duration-150 pointer-events-none',
            (local.indicatorPosition ?? 'bottom') === 'top'
              ? 'top-0'
              : 'bottom-0'
          )}
          style={{
            left: `${indicatorStyle().left}px`,
            width: `${indicatorStyle().width}px`,
          }}
        />
      </div>
    </KSegmentedControl>
  );
};
