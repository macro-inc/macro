import { SegmentedControl as KSegmentedControl } from '@kobalte/core/segmented-control';
import { For, type JSX } from 'solid-js';
import { cn } from '../utils/classname';

type SegmentedControlOption<T extends string | number | boolean> = {
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
        'border border-edge-frame rounded-full inline-flex overflow-hidden',
        size() === 'sm' ? 'h-6' : 'h-8',
        props.class
      )}
    >
      <For each={props.options}>
        {(option) => (
          <KSegmentedControl.Item
            value={serialize(option.value)}
            disabled={option.disabled}
            class={cn(
              'relative flex h-full items-center justify-center border-r border-edge-divider last:border-r-0 font-medium outline-none has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-edge-focus transition-colors duration-120 motion-reduce:transition-none',
              size() === 'sm' ? 'px-2 text-xs' : 'px-3 text-sm',
              option.disabled
                ? 'opacity-50'
                : 'text-ink-muted not-touch:hover:text-ink not-touch:hover:overlay-hover active:overlay-active data-checked:text-ink data-checked:overlay-active'
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
