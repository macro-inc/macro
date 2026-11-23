import { CollapsibleSection } from '@app/components/view-shell';
import { SidebarSectionDragHandle } from '@app/components/view-shell/SidebarSectionDragHandle';
import { cn, Tooltip } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';
import type { useSectionReorder } from './useSectionReorder';

/** Shared heading for built-in and custom Chat sections. */
export function ChannelSectionHeading(props: {
  id: string;
  label: string;
  tooltip?: string;
  open: boolean;
  focused: boolean;
  unreadCount: number;
  onToggle: () => void;
  badge?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root open={props.open} onOpenChange={props.onToggle}>
      <CollapsibleSection.Header
        class={cn(
          'relative rounded-lg pr-0',
          props.focused && 'bg-hover text-ink'
        )}
      >
        <CollapsibleSection.Trigger
          id={props.id}
          role="treeitem"
          tabIndex={-1}
          class={cn('flex-1', props.focused && 'text-ink')}
        >
          <Tooltip
            as="span"
            class="relative z-20 min-w-0"
            label={props.tooltip ?? props.label}
          >
            <span class="truncate">{props.label}</span>
          </Tooltip>
          {props.badge}
          <CollapsibleSection.Indicator />
          <Show when={props.unreadCount > 0}>
            <span class="text-xs text-accent">{props.unreadCount}</span>
          </Show>
        </CollapsibleSection.Trigger>
        <div
          class="flex shrink-0 items-center"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {props.children}
        </div>
      </CollapsibleSection.Header>
    </CollapsibleSection.Root>
  );
}

/** Drag from the heading; reveal the icon-free reorder control on keyboard focus. */
export function DraggableChannelSectionHeading(props: {
  section: ChannelSectionKey;
  label: string;
  reorder: ReturnType<typeof useSectionReorder>;
  children: JSX.Element;
}) {
  return (
    <SidebarSectionDragHandle
      section={props.section}
      label={props.label}
      reorder={props.reorder}
      dragType="channel-section"
    >
      {props.children}
    </SidebarSectionDragHandle>
  );
}
