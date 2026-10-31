import { ViewSidebar } from '@app/components/view-shell';
import { ChannelMutedIndicator } from '@channel/components/ChannelMutedIndicator';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type ChannelEntity, Entity } from '@entity';
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { cn, Tooltip } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import { CHANNELS_TOUR } from '../../tour';
import { formatDetailedTimestamp } from '../../utils';
import {
  ChannelAvatar,
  ChannelCallIndicator,
  ChannelRailItemContextMenu,
  IncomingCallActions,
  isPrimaryMouseDown,
} from './ChannelRailItems';
import {
  type ChannelLabelDragData,
  type ChannelLabelDropData,
  type ChannelRailRow,
  rowKeyForChannel,
  useChannelsRail,
} from './ChannelsRailContext';
import { useChannelRailItemState } from './hooks/useChannelRailState';
import { ChannelLabelMenuItems } from './next/ChannelLabelRows';

/**
 * Drag a channel between labels. Registered once per Channels-section row: a
 * row is the drag source, and also a drop target that means "into this row's
 * label" (or "group these two" when the row is in no label).
 */
function createChannelLabelDnd(props: {
  channel: ChannelEntity;
  rowId: string;
  labelId: () => string | undefined;
  /** Drops are refused while the team's labels are unavailable. */
  disabled: () => boolean;
}) {
  const rail = useChannelsRail();
  const draggable = createDraggable(
    `${rail.railId}:channel-label:drag:${props.rowId}`,
    {
      dragType: 'channel-label',
      dndScope: rail.railId,
      channelId: props.channel.id,
      get labelId() {
        return rail
          .labels()
          .find(
            (label) =>
              !label.rule && label.channelIds.includes(props.channel.id)
          )?.id;
      },
      name: props.channel.name,
      iconType: 'channel',
    } satisfies ChannelLabelDragData
  );
  const droppable = createDroppable(
    `${rail.railId}:channel-label:channel:${props.rowId}`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      get target() {
        const labelId = props.labelId();
        const label = rail.labels().find((label) => label.id === labelId);
        return labelId
          ? {
              kind: label?.rule ? ('smart-tag' as const) : ('label' as const),
              labelId,
            }
          : { kind: 'channel' as const, channelId: props.channel.id };
      },
      isDropTargetDisabled: props.disabled,
    } satisfies ChannelLabelDropData
  );
  return { draggable, droppable };
}

export function ChannelOption(props: {
  channel: ChannelEntity;
  /** The list row this option stands for; defaults to the channel's own row. */
  rowId?: ChannelRailRow['id'];
  /** Containing section for drag-and-drop targets. */
  labelId?: string;
  /** Make a team-channel row draggable between labels (Team channels section only). */
  draggable?: boolean;
}) {
  const rail = useChannelsRail();
  const rowId = () => props.rowId ?? rowKeyForChannel(props.channel.id);
  const item = useChannelRailItemState(() => props.channel.id, rowId);
  const timestamp = () =>
    props.channel.latestRootMessage?.createdAt ?? props.channel.updatedAt;
  // Whether a row participates in drag and drop is fixed per mount.
  const dnd = props.draggable
    ? createChannelLabelDnd({
        channel: props.channel,
        rowId: rowId(),
        labelId: () => props.labelId,
        disabled: () =>
          !rail.labelsAvailable() || !canLabelChannel(props.channel),
      })
    : undefined;

  // Selection belongs to a click, never the press that starts a drag.
  let didDrag = false;
  const [, dragActions] = useDragDropContext() ?? [];
  dragActions?.onDragStart(({ draggable }) => {
    if (
      draggable.data.dndScope === rail.railId &&
      draggable.data.channelId === props.channel.id
    )
      didDrag = true;
  });

  // A plain row highlights alone (dropping on it groups the two); a row in a
  // label is highlighted as part of its whole label by ChannelsSectionRows.
  const isGroupingTarget = () => {
    const target = rail.activeDropTarget();
    return target?.kind === 'channel' && target.channelId === props.channel.id;
  };

  return (
    <div
      ref={(element) => {
        dnd?.draggable.ref(element);
        dnd?.droppable.ref(element);
      }}
      {...(canLabelChannel(props.channel) ? dnd?.draggable.dragActivators : {})}
      onPointerDown={(event) => {
        didDrag = false;
        rail.prefetchRow(rowId(), event);
      }}
      class={cn(
        'min-w-0',
        !rail.sectionsEnabled() &&
          props.labelId !== undefined &&
          'relative pl-(--sidebar-icon-slot) before:pointer-events-none before:absolute before:inset-y-0 before:left-(--sidebar-local-rail) before:w-px before:-translate-x-1/2 before:bg-edge-muted',
        props.draggable && 'pb-0.5',
        isGroupingTarget() &&
          'rounded-lg bg-selected ring-1 ring-inset ring-accent',
        dnd?.draggable.isActiveDraggable && 'opacity-50'
      )}
    >
      <ChannelRailItemContextMenu
        channel={props.channel}
        class="block w-full"
        extraItems={<ChannelLabelMenuItems channel={props.channel} />}
      >
        <ViewSidebar.Item
          as="div"
          ref={tourTarget(CHANNELS_TOUR.conversation)}
          id={item().domId}
          role="treeitem"
          tabIndex={-1}
          class={cn(
            'group/channel-option relative',
            !item().selected &&
              !isTouchDevice() &&
              item().focused &&
              'bg-hover text-ink'
          )}
          active={item().selected && !isTouchDevice()}
          aria-current={item().selected ? 'page' : undefined}
          onClick={(event) => {
            if (!isPrimaryMouseDown(event) || didDrag) return;
            rail.activateRow(rowId(), event);
          }}
        >
          <ViewSidebar.Icon>
            <ChannelAvatar channel={props.channel} />
          </ViewSidebar.Icon>
          <span class="min-w-0 flex-1 truncate">{props.channel.name}</span>
          <span class="flex shrink-0 items-center gap-2">
            <ChannelMutedIndicator muted={item().muted} />
            <ChannelCallIndicator
              status={item().incomingCallId ? undefined : item().callStatus}
            />
            <Show when={item().unread}>
              <span
                aria-label="Unread"
                class="size-2 shrink-0 rounded-full bg-accent"
              />
            </Show>
            <Show when={!item().incomingCallId && timestamp()}>
              {(value) => (
                <span class="relative hidden shrink-0 group-hover/channel-option:block touch:hidden">
                  <span
                    aria-hidden="true"
                    class="invisible whitespace-nowrap text-xs font-light"
                  >
                    <Entity.Timestamp
                      entity={props.channel}
                      overrideTimeStamp={value()}
                    />
                  </span>
                  <Tooltip
                    label={formatDetailedTimestamp(value())}
                    placement="top"
                    class="absolute inset-0 flex items-center"
                  >
                    <span class="whitespace-nowrap text-xs font-light text-ink-extra-muted">
                      <Entity.Timestamp
                        entity={props.channel}
                        overrideTimeStamp={value()}
                      />
                    </span>
                  </Tooltip>
                </span>
              )}
            </Show>
          </span>
          <IncomingCallActions
            callId={item().incomingCallId}
            channelId={props.channel.id}
          />
        </ViewSidebar.Item>
      </ChannelRailItemContextMenu>
    </div>
  );
}
