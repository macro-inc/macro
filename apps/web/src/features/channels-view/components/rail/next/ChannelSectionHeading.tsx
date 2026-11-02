import { CollapsibleSection } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import DotsSixVerticalIcon from '@icon/system/regular/dots-six-vertical.svg';
import { createDraggable } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { ChannelSectionKey } from '../../../types';
import type { useSectionReorder } from './useSectionReorder';

/** Shared heading for built-in and custom Chat sections. */
export function ChannelSectionHeading(props: {
  id: string;
  label: string;
  title?: string;
  open: boolean;
  focused: boolean;
  unreadCount: number;
  onToggle: () => void;
  badge?: JSX.Element;
  dragHandle?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <CollapsibleSection.Root open={props.open} onOpenChange={props.onToggle}>
      <CollapsibleSection.Header
        class={cn('rounded-lg pr-0', props.focused && 'bg-hover text-ink')}
      >
        <CollapsibleSection.Trigger
          id={props.id}
          role="treeitem"
          tabIndex={-1}
          title={props.title}
          class={cn('flex-1', props.focused && 'text-ink')}
        >
          <span class="min-w-0 truncate">{props.label}</span>
          {props.badge}
          <CollapsibleSection.Indicator />
          <Show when={props.unreadCount > 0}>
            <span class="text-xs text-accent">{props.unreadCount}</span>
          </Show>
        </CollapsibleSection.Trigger>
        <div class="flex shrink-0 items-center">
          {props.dragHandle}
          {props.children}
        </div>
      </CollapsibleSection.Header>
    </CollapsibleSection.Root>
  );
}

/** Keep disclosure clicks separate from section dragging and keyboard reordering. */
export function ChannelSectionDragHandle(props: {
  section: ChannelSectionKey;
  label: string;
  reorder: ReturnType<typeof useSectionReorder>;
}) {
  const draggable = createDraggable(`${props.reorder.scope}:${props.section}`, {
    dragType: 'channel-section',
    dndScope: props.reorder.scope,
    section: props.section,
    get name() {
      return props.label;
    },
    overlayIcon: () => <DotsSixVerticalIcon class="size-4" />,
  });

  return (
    <Button
      ref={draggable.ref}
      {...draggable.dragActivators}
      variant="ghost"
      size="icon-xs"
      class="shrink-0 cursor-grab opacity-0 group-hover/rail-section:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
      aria-label={t('channelSections.reorderSection', { name: props.label })}
      tooltip={t('channelSections.reorderSectionHint')}
      onClick={(event: MouseEvent) => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        props.reorder.move(props.section, event.key === 'ArrowUp' ? -1 : 1);
      }}
    >
      <DotsSixVerticalIcon class="size-3.5" />
    </Button>
  );
}
