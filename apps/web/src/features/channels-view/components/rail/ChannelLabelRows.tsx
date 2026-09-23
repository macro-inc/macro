import { ViewSidebar } from '@app/components/view-shell';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ChannelEntity } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretDownIcon from '@phosphor/caret-down.svg';
import ChecksIcon from '@phosphor/checks.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import FilterIcon from '@phosphor/funnel-simple.svg';
import HashIcon from '@phosphor/hash.svg';
import PencilSimpleIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import TagIcon from '@phosphor/tag.svg';
import TagSimpleIcon from '@phosphor/tag-simple.svg';
import TrashIcon from '@phosphor/trash.svg';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { cn, Dropdown } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import { isPrimaryMouseDown } from './ChannelRailItems';
import {
  type ChannelLabelDropData,
  rowKeyForLabel,
  useChannelsRail,
} from './ChannelsRailContext';
import { useChannelRailLabelState } from './hooks/useChannelRailState';

type MenuIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** A dropdown row in the house style: muted icon, muted label. */
function MenuRow(props: {
  icon: MenuIcon;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Dropdown.Item disabled={props.disabled} onSelect={props.onSelect}>
      <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
        <props.icon class="size-3.5" />
      </span>
      <span class="flex-1 truncate text-ink-muted">{props.label}</span>
    </Dropdown.Item>
  );
}

/** Count pill used by section headings, reused so labels read the same way. */
function UnreadPill(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-xs font-medium leading-none tabular-nums text-accent-contrast">
        {props.count}
      </span>
    </Show>
  );
}

/**
 * A label heading inside the Channels section: the name, how many of
 * its channels are unread, a `···` menu, and the disclosure caret. Clicking
 * the row toggles it, like a section heading; the state is per user. Edits
 * explain their scope in a dialog, so the menu stays plain.
 */
export function ChannelLabelRow(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const state = useChannelRailLabelState(() => props.label);
  const droppable = createDroppable(
    `${rail.railId}:channel-label:label:${props.label.id}`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      target: {
        kind: props.label.rule ? 'smart-tag' : 'label',
        labelId: props.label.id,
      },
      isDropTargetDisabled: () => !rail.labelsAvailable(),
    } satisfies ChannelLabelDropData
  );

  const isDropTarget = () => {
    const target = rail.activeDropTarget();
    return target?.kind === 'label' && target.labelId === props.label.id;
  };

  return (
    <div
      ref={droppable.ref}
      class={cn(
        'group/channel-label relative min-w-0 rounded-lg pb-0.5',
        isDropTarget() && 'bg-selected'
      )}
    >
      <ViewSidebar.Item
        as="div"
        id={state().domId}
        role="treeitem"
        tabIndex={-1}
        title={
          props.label.rule
            ? `Name contains “${props.label.rule.contains}”`
            : props.label.name
        }
        aria-expanded={state().open}
        class={cn(
          'pr-15 font-medium',
          !isTouchDevice() && state().focused && 'bg-hover text-ink'
        )}
        onMouseDown={(event) => {
          if (!isPrimaryMouseDown(event)) return;
          event.preventDefault();
          rail.activateRow(rowKeyForLabel(props.label.id), event);
        }}
      >
        <span class="min-w-0 flex-1 truncate">{props.label.name}</span>
        <UnreadPill count={state().unreadCount} />
      </ViewSidebar.Item>
      <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        <Dropdown placement="bottom-end">
          <Dropdown.Trigger
            as={ViewSidebar.Control}
            variant="ghost"
            size="icon-sm"
            label={`Options for ${props.label.name}`}
            class="opacity-0 transition-opacity group-hover/channel-label:opacity-100 focus-visible:opacity-100 data-expanded:opacity-100 touch:opacity-100"
            onMouseDown={(event: MouseEvent) => event.stopPropagation()}
          >
            <DotsThreeIcon class="size-3.5" />
          </Dropdown.Trigger>
          <Dropdown.Content
            class="min-w-44"
            onCloseAutoFocus={(event) => {
              if (document.querySelector('[role="dialog"]'))
                event.preventDefault();
            }}
          >
            <Dropdown.Group>
              <MenuRow
                icon={PencilSimpleIcon}
                label={props.label.rule ? 'Edit smart label' : 'Rename'}
                onSelect={() =>
                  void (props.label.rule
                    ? rail.editSmartTag(props.label)
                    : rail.renameLabel(props.label))
                }
              />
              <MenuRow
                icon={ChecksIcon}
                label="Mark all as read"
                disabled={state().unreadCount === 0}
                onSelect={() => rail.markLabelRead(props.label)}
              />
            </Dropdown.Group>
            <Dropdown.Separator class="my-1 h-px border-0 bg-edge-muted" />
            <Dropdown.Group>
              <MenuRow
                icon={TrashIcon}
                label={props.label.rule ? 'Delete smart label' : 'Delete label'}
                onSelect={() => void rail.deleteLabel(props.label)}
              />
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <ViewSidebar.Control
          label={`${state().open ? 'Collapse' : 'Expand'} ${props.label.name}`}
          aria-expanded={state().open}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => rail.toggleLabel(props.label.id)}
        >
          <CaretDownIcon
            class={cn(
              'size-3 transition-transform -rotate-90',
              state().open && 'rotate-0'
            )}
          />
        </ViewSidebar.Control>
      </span>
    </div>
  );
}

/** The Channels section's create action: a channel, or a label. */
export function ChannelsCreateMenu() {
  const rail = useChannelsRail();

  return (
    <Show
      when={rail.channelTagsEnabled() && rail.labelsAvailable()}
      fallback={
        <ViewSidebar.Control
          label="Create channel"
          onClick={openNewChannelModal}
        >
          <PlusIcon class="size-3.5" />
        </ViewSidebar.Control>
      }
    >
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          as={ViewSidebar.Control}
          variant="ghost"
          size="icon-sm"
          label="Create channel or label"
        >
          <PlusIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          class="min-w-44"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]'))
              event.preventDefault();
          }}
        >
          <Dropdown.Group>
            <MenuRow
              icon={HashIcon}
              label="New channel"
              onSelect={openNewChannelModal}
            />
            <MenuRow
              icon={TagIcon}
              label="New label"
              onSelect={() => void rail.createLabel([])}
            />
            <MenuRow
              icon={FilterIcon}
              label="New smart label"
              onSelect={() => void rail.createSmartTag()}
            />
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

/**
 * "Move to label" for a channel's context menu. Includes empty labels.
 */
export function ChannelLabelMenuItems(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const currentLabel = () =>
    rail
      .labels()
      .find(
        (label) => !label.rule && label.channelIds.includes(props.channel.id)
      );

  return (
    <Show
      when={
        rail.channelTagsEnabled() &&
        canLabelChannel(props.channel) &&
        rail.labelsAvailable()
      }
    >
      <Show when={currentLabel()}>
        {(label) => (
          <MenuItem
            icon={TagSimpleIcon}
            text={`Ungroup from “${label().name}”`}
            onClick={() => rail.setChannelLabel(props.channel.id, undefined)}
          />
        )}
      </Show>
      <ContextMenu.Sub>
        <SubTrigger
          icon={TagIcon}
          text={currentLabel() ? 'Move to label' : 'Add to label'}
        />
        <ContextMenuContent submenu class="w-56 text-xs text-ink-muted">
          {/* Kobalte radio items only work inside a RadioGroup. */}
          <ContextMenu.RadioGroup
            value={currentLabel()?.id ?? ''}
            onChange={(labelId) =>
              rail.setChannelLabel(props.channel.id, labelId)
            }
          >
            <For each={rail.labels().filter((label) => !label.rule)}>
              {(label) => (
                <MenuItem
                  selectorType="radio"
                  value={label.id}
                  groupValue={currentLabel()?.id ?? ''}
                  text={label.name}
                />
              )}
            </For>
          </ContextMenu.RadioGroup>
          <Show when={rail.labels().some((label) => !label.rule)}>
            <MenuSeparator />
          </Show>
          <MenuItem
            icon={PlusIcon}
            text="New label…"
            onClick={() => void rail.createLabel([props.channel.id])}
          />
        </ContextMenuContent>
      </ContextMenu.Sub>
    </Show>
  );
}
