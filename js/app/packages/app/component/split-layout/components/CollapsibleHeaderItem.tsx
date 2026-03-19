import { createSignal, type JSX, Show } from 'solid-js';
import { useRegisterCollapsibleHeaderItem } from '../layoutUtils';

type CollapsibleHeaderItemProps = {
  id: string;
  priority: number;
  expanded: JSX.Element;
  collapsed: JSX.Element;
  onCollapsedChange?: (isCollapsed: boolean) => void;
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
        <div ref={setExpandedRef} class="flex items-center">
          {props.expanded}
        </div>
      </Show>
      <Show when={isCollapsed()}>
        <div ref={setCollapsedRef} class="flex items-center">
          {props.collapsed}
        </div>
      </Show>
    </>
  );
}
