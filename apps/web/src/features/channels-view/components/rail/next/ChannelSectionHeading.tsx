import { createDistancePointerSensor } from '@app/components/drag-drop/create-distance-pointer-sensor';
import { CollapsibleSection } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import DotsSixVerticalIcon from '@icon/system/regular/dots-six-vertical.svg';
import { createDraggable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn, Tooltip } from '@ui';
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

/** Drag from the heading or its grip without toggling disclosure after a drop. */
export function DraggableChannelSectionHeading(props: {
  section: ChannelSectionKey;
  label: string;
  reorder: ReturnType<typeof useSectionReorder>;
  children: JSX.Element;
}) {
  const dragId = `${props.reorder.scope}:${props.section}`;
  const draggable = createDraggable(dragId, {
    dragType: 'channel-section',
    dndScope: props.reorder.scope,
    section: props.section,
    get name() {
      return props.label;
    },
    overlayContent: () => (
      <div class="w-56 p-1">
        <div class="flex min-w-0 items-center gap-2 text-xs font-medium text-ink">
          <DotsSixVerticalIcon class="size-3.5 shrink-0 text-ink-muted" />
          <span class="truncate">{props.label}</span>
        </div>
        <p class="mt-2 border-t border-edge-muted pt-2 text-xs text-ink-muted">
          {t('channelSections.reorderingSection')}
        </p>
      </div>
    ),
  });

  const pointer = createDistancePointerSensor(8, props.reorder.cancel, {
    id: `${dragId}:pointer`,
    manual: true,
  });
  const [, actions] = useDragDropContext() ?? [];
  let didDrag = false;

  actions?.onDragStart(({ draggable: source }) => {
    if (source.id === dragId) {
      didDrag = true;
    }
  });

  const preventToggleAfterDrag = (event: MouseEvent) => {
    if (!didDrag || event.detail === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={draggable.ref}
      class="group/section-heading relative cursor-grab active:cursor-grabbing"
      onMouseDown={(event) => pointer.start(event, dragId)}
      onPointerDown={() => {
        didDrag = false;
      }}
      on:click={{ capture: true, handleEvent: preventToggleAfterDrag }}
    >
      <Button
        variant="ghost"
        appearance="bare"
        size="icon-xs"
        class="absolute -left-(--sidebar-gutter) top-1 z-10 cursor-grab opacity-0 group-hover/section-heading:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
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
        <DotsSixVerticalIcon class="-ml-2 size-3" />
      </Button>
      {props.children}
    </div>
  );
}
