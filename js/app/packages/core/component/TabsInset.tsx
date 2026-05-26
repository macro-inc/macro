import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import { cn, Layer } from '@ui';
import { For, type JSX, splitProps } from 'solid-js';

type TabItem = {
  value: string;
  label: string | JSX.Element;
};

type TabsInsetProps = {
  list: TabItem[];
  value?: string;
  defaultValue?: string;
  class?: string;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
} & Omit<SegmentedControlRootProps, 'defaultValue'>;

export const TabsInset = (props: TabsInsetProps) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
    'depth',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full flex items-center', local.class)}
    >
      <Layer depth={local.depth ?? 0}>
        <div class="relative flex items-center bg-surface rounded-lg p-0.5 ring ring-edge-muted">
          <For each={local.list}>
            {(item) => (
              <Layer depth={2}>
                <KSegmentedControl.Item
                  value={item.value}
                  disabled={local.disabled}
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel
                    class="flex items-center px-2.5 py-1 text-xs font-medium data-checked:ring data-checked:ring-edge-muted ring-inset rounded-md text-ink-extra-muted hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    onPointerDown={(e) => {
                      if (isTouchDevice()) e.preventDefault();
                    }}
                    onClick={() => rootProps.onChange?.(item.value)}
                  >
                    {item.label}
                  </KSegmentedControl.ItemLabel>
                </KSegmentedControl.Item>
              </Layer>
            )}
          </For>
        </div>
      </Layer>
    </KSegmentedControl>
  );
};
