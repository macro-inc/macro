import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import { For, type ParentComponent } from 'solid-js';

export const TabbedControl: ParentComponent<
  {
    list: { value: string; label: string }[];
    value?: string;
    defaultValue?: string;
  } & Omit<SegmentedControlRootProps, 'defaultValue'>
> = (props) => {
  return (
    <KSegmentedControl
      class="w-full text-sm rounded-full relative"
      value={props.value}
      defaultValue={props.defaultValue ?? props.list[0]?.value}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <div class="relative" role="presentation">
        <div class="flex h-8" role="presentation">
          <For each={props.list}>
            {(item) => (
              <KSegmentedControl.Item
                value={item.value}
                disabled={props.disabled}
                class="relative flex-1 rounded-full has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus data-disabled:pointer-events-none data-disabled:opacity-50"
              >
                <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                <KSegmentedControl.ItemLabel class="relative flex size-full items-center justify-center rounded-full border border-transparent px-4 text-xs font-medium text-ink-extra-muted data-checked:text-ink data-checked:bg-active data-checked:border-edge-frame hover:text-ink select-none transition-colors duration-120 motion-reduce:transition-none">
                  {item.label}
                </KSegmentedControl.ItemLabel>
              </KSegmentedControl.Item>
            )}
          </For>
        </div>
      </div>
    </KSegmentedControl>
  );
};
