import { SegmentedControl as KSegmentedControl } from '@kobalte/core/segmented-control';
import { cn } from '@ui/utils/classname';
import { For, type JSX } from 'solid-js';

export type SegmentedControlOption<T extends string | number | boolean> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type SegmentedControlProps<T extends string | number | boolean> = {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  class?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
};

const serialize = (v: string | number | boolean): string => String(v);

export const SegmentedControl = <T extends string | number | boolean>(
  props: SegmentedControlProps<T>
): JSX.Element => {
  const size = () => props.size ?? 'md';

  const handleChange = (serialized: string) => {
    const match = props.options.find((o) => serialize(o.value) === serialized);
    if (match && !match.disabled) {
      props.onChange(match.value);
    }
  };

  return (
    <KSegmentedControl
      value={serialize(props.value)}
      onChange={handleChange}
      aria-label={props['aria-label']}
      class={cn(
        'border border-edge-muted rounded-xs inline-flex overflow-hidden',
        props.class
      )}
    >
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={serialize(option.value)}
            disabled={option.disabled}
            class={cn(
              'relative flex items-center justify-center border-r border-edge-muted last:border-r-0 font-medium',
              size() === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              option.disabled
                ? 'opacity-50'
                : 'text-ink-muted hover:text-ink hover:bg-ink/15 data-checked:text-ink data-checked:bg-ink/10 data-checked:hover:bg-ink/20'
            )}
          >
            <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
            <KSegmentedControl.ItemLabel>
              {option.label}
            </KSegmentedControl.ItemLabel>
          </KSegmentedControl.Item>
        )}
      </For>
    </KSegmentedControl>
  );
};
