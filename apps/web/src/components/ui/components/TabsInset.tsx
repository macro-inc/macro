import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import { For, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { InsetControlTrack } from './InsetControlTrack';
import { Layer } from './Layer';

export type InsetTabItem = {
  value: string;
  label: string | JSX.Element;
  disabled?: boolean;
};

export type TabsInsetProps = {
  list: InsetTabItem[];
  value?: string;
  defaultValue?: string;
  class?: string;
  trackClass?: string;
  itemClass?: string;
  labelClass?: string;
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
    'trackClass',
    'itemClass',
    'labelClass',
    'depth',
    'fullWidth',
  ]);

  // The track sits at the control's depth (matching the panel it's on); the
  // checked item uses the highest surface so the active pill still reads
  // as raised regardless of the panel depth.
  const trackDepth = () => local.depth ?? 0;
  const vertical = () => rootProps.orientation === 'vertical';

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn(
        'h-full inline-flex items-center',
        local.fullWidth && 'w-full',
        local.class
      )}
    >
      <Layer depth={trackDepth()}>
        <InsetControlTrack
          class={cn(
            local.fullWidth && 'w-full',
            vertical() && 'flex-col items-stretch rounded-2xl',
            local.trackClass
          )}
        >
          <Layer depth={4}>
            <KSegmentedControl.Indicator class="pointer-events-none absolute left-0.5 top-0.5 z-0 rounded-full data-[orientation=vertical]:rounded-xl bg-surface ring-1 ring-inset ring-edge-frame shadow-[0_1px_3px_oklch(0_0_0/0.12)] transition-[transform,width,height] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" />
          </Layer>
          <For each={local.list}>
            {(item) => (
              <KSegmentedControl.Item
                value={item.value}
                disabled={local.disabled || item.disabled}
                class={cn(
                  'relative z-1 rounded-full data-disabled:opacity-50 data-disabled:pointer-events-none',
                  local.fullWidth && !vertical() && 'flex-1',
                  vertical() && 'w-full rounded-xl',
                  local.itemClass
                )}
              >
                <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                <KSegmentedControl.ItemLabel
                  class={cn(
                    'flex items-center px-3 py-1 text-xs font-medium rounded-full text-ink-extra-muted hover:text-ink data-checked:text-ink transition-colors duration-150 motion-reduce:transition-none',
                    local.fullWidth && 'w-full justify-center',
                    vertical() && 'justify-start rounded-xl',
                    local.labelClass
                  )}
                  onPointerDown={(e) => {
                    if (isTouchDevice()) e.preventDefault();
                  }}
                  onClick={() => {
                    if (!local.disabled && !item.disabled)
                      rootProps.onChange?.(item.value);
                  }}
                >
                  {item.label}
                </KSegmentedControl.ItemLabel>
              </KSegmentedControl.Item>
            )}
          </For>
        </InsetControlTrack>
      </Layer>
    </KSegmentedControl>
  );
};
