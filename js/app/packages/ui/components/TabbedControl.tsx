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
      class="w-full text-sm rounded-xs border border-edge-muted relative overflow-hidden"
      value={props.value}
      defaultValue={props.defaultValue ?? props.list[0]?.value}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <div class="relative" role="presentation">
        <div class="flex" role="presentation">
          <For each={props.list}>
            {(item) => (
              <KSegmentedControl.Item
                value={item.value}
                disabled={props.disabled}
                class="border-r border-edge-muted last:border-r-0"
              >
                <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                <KSegmentedControl.ItemLabel class="relative text-ink-muted/70 size-full px-2.5 py-1 text-xs font-medium data-checked:text-ink data-checked:bg-edge hover:text-ink hover:bg-ink/6 data-checked:hover:bg-edge block">
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
