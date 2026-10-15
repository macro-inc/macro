import type { JSX } from 'solid-js';
import { cn } from '../utils/classname';
import { TabsInset } from './TabsInset';

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

/**
 * @do Use for a small set of mutually exclusive views or filters.
 * @dont Use segmented choices for independent creation actions; use buttons or a menu.
 */
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
    <TabsInset
      value={serialize(props.value)}
      onChange={handleChange}
      aria-label={props['aria-label']}
      list={props.options.map((option) => ({
        ...option,
        value: serialize(option.value),
      }))}
      class={cn(size() === 'sm' ? 'h-6' : 'h-8', props.class)}
      trackClass="h-full w-full"
      itemClass="h-full"
      labelClass={cn(
        'h-full py-0',
        size() === 'sm' ? 'px-2 text-xs' : 'px-3 text-xs'
      )}
    />
  );
};
