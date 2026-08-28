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
  depth?: 0 | 1 | 2 | 3 | 4;
  fullWidth?: boolean;
} & Omit<SegmentedControlRootProps, 'defaultValue'>;

export const TabsInset = (props: TabsInsetProps) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
    'depth',
    'fullWidth',
  ]);

  // The track sits at the control's depth (matching the panel it's on); the
  // checked item is elevated two steps above it so the active pill still reads
  // as raised regardless of the panel depth.
  const trackDepth = () => local.depth ?? 0;
  const itemDepth = () => Math.min(4, trackDepth() + 2) as 0 | 1 | 2 | 3 | 4;

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn(
        'h-full flex items-center',
        local.fullWidth && 'w-full',
        local.class
      )}
    >
      <Layer depth={trackDepth()}>
        <div
          class={cn(
            'relative flex items-center border border-edge-muted bg-surface rounded-lg p-0.5 has-focus-visible:ring-2 has-focus-visible:ring-accent/20',
            local.fullWidth && 'w-full'
          )}
        >
          <For each={local.list}>
            {(item) => (
              <Layer depth={itemDepth()}>
                <KSegmentedControl.Item
                  value={item.value}
                  disabled={local.disabled}
                  class={cn(local.fullWidth && 'flex-1')}
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel
                    class={cn(
                      'flex items-center px-2.5 py-1 text-xs font-medium data-checked:ring data-checked:ring-edge-muted ring-inset rounded-md text-ink-extra-muted hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:shadow-[0_1px_2px_rgba(0,0,0,0.06)]',
                      local.fullWidth && 'w-full justify-center'
                    )}
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
