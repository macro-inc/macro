import { cn } from '@ui';
import type { Accessor, JSX } from 'solid-js';
import {
  useRegisterCollapsibleHeaderItem,
  useRegisterCollapsibleToolbarItem,
} from '../layoutUtils';

type CollapsibleItemProps = {
  id: string;
  priority: number;
  children: (isCollapsed: Accessor<boolean>) => JSX.Element;
  onCollapsedChange?: (isCollapsed: boolean) => void;
  containerClass?: string;
};

function CollapsibleItem(
  props: CollapsibleItemProps & { region: 'header' | 'toolbar' }
) {
  const register =
    props.region === 'header'
      ? useRegisterCollapsibleHeaderItem
      : useRegisterCollapsibleToolbarItem;
  const isCollapsed = register({
    id: props.id,
    priority: props.priority,
    onCollapsedChange: (v) => props.onCollapsedChange?.(v),
  });

  return (
    <div class={cn('flex items-center', props.containerClass)}>
      {props.children(isCollapsed)}
    </div>
  );
}

export function CollapsibleHeaderItem(props: CollapsibleItemProps) {
  return <CollapsibleItem {...props} region="header" />;
}

export function CollapsibleToolbarItem(props: CollapsibleItemProps) {
  return <CollapsibleItem {...props} region="toolbar" />;
}
