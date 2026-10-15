import type { SegmentedControlRootProps } from '@kobalte/core/segmented-control';
import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { TabsInset } from './TabsInset';

export type TabItem = {
  value: string;
  label: string | (() => JSX.Element);
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

/** Compatibility adapter for the shared inset segmented control. */
export const Tabs = (props: TabsProps) => {
  const [local, rest] = splitProps(props, ['list', 'class', 'labelClass']);
  return (
    <TabsInset
      {...rest}
      list={local.list.map((item) => ({
        value: item.value,
        label: typeof item.label === 'function' ? item.label() : item.label,
      }))}
      class={cn('h-auto', local.class)}
      labelClass={cn('py-1.5', local.labelClass)}
    />
  );
};
