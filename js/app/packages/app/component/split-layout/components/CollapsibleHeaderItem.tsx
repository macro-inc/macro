import { createSignal, type JSX, Show } from 'solid-js';
import { useRegisterCollapsibleHeaderItem } from '../layoutUtils';
import { cn } from '@ui';

type CollapsibleHeaderItemProps = {
  id: string;
  priority: number;
  expanded: () => JSX.Element;
  collapsed: () => JSX.Element;
  onCollapsedChange?: (isCollapsed: boolean) => void;
  containerClass?: string;
};

export function CollapsibleHeaderItem(props: CollapsibleHeaderItemProps) {
  const [expandedRef, setExpandedRef] = createSignal<HTMLElement | null>(null);
  const [collapsedRef, setCollapsedRef] = createSignal<HTMLElement | null>(
    null
  );

  const [isCollapsed] = useRegisterCollapsibleHeaderItem({
    id: props.id,
    priority: props.priority,
    ref: expandedRef,
    collapsedRef: collapsedRef,
    onCollapsedChange: (v) => props.onCollapsedChange?.(v),
  });

  return (
    <>
      <Show when={!isCollapsed()}>
        <div
          ref={setExpandedRef}
          class={cn('flex items-center', props.containerClass)}
        >
          {props.expanded()}
        </div>
      </Show>
      <Show when={isCollapsed()}>
        <div
          ref={setCollapsedRef}
          class={cn('flex items-center', props.containerClass)}
        >
          {props.collapsed()}
        </div>
      </Show>
    </>
  );
}
