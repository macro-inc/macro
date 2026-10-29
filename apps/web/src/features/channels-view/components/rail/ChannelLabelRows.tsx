import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ChecksIcon from '@icon/system/regular/checks.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import PencilSimpleIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
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
            ? t('channelLabels.nameContains', {
                text: props.label.rule.contains,
              })
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
        <Show when={props.label.teamId}>
          <span class="text-xs text-ink-extra-muted">
            {t('channelSections.sharedShort')}
          </span>
        </Show>
        <UnreadPill count={state().unreadCount} />
      </ViewSidebar.Item>
      <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        <Dropdown placement="bottom-end">
          <Dropdown.Trigger
            aria-label={`Options for ${props.label.name}`}
            tooltip={`Options for ${props.label.name}`}
            as={ViewSidebar.Control}
            variant="ghost"
            size="icon-sm"
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
                label={
                  props.label.rule
                    ? t('channelLabels.editSmartLabel')
                    : t('entityActions.rename')
                }
                onSelect={() =>
                  fireAndForget(
                    props.label.rule
                      ? rail.editSmartTag(props.label)
                      : rail.renameLabel(props.label),
                    'channels-view'
                  )
                }
              />
              <MenuRow
                icon={ChecksIcon}
                label={t('channelLabels.markAllAsRead')}
                disabled={state().unreadCount === 0}
                onSelect={() => rail.markLabelRead(props.label)}
              />
            </Dropdown.Group>
            <Dropdown.Separator class="my-1 h-px border-0 bg-edge-divider" />
            <Dropdown.Group>
              <MenuRow
                icon={TrashIcon}
                label={
                  props.label.rule
                    ? t('channelLabels.deleteSmartLabel')
                    : t('channelLabels.deleteLabel')
                }
                onSelect={() =>
                  fireAndForget(rail.deleteLabel(props.label), 'channels-view')
                }
              />
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <ViewSidebar.Control
          aria-label={`${state().open ? 'Collapse' : 'Expand'} ${props.label.name}`}
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

/** Personal and shared sections use the same channel-label storage. */
export function ChannelsCreateMenu() {
  const rail = useChannelsRail();
  return (
    <Show when={rail.channelTagsEnabled() && rail.labelsAvailable()}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          aria-label={t('channelSections.newSection')}
          tooltip={t('channelSections.newSection')}
          as={ViewSidebar.Control}
          variant="ghost"
          size="icon-sm"
        >
          <PlusIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-48">
          <Dropdown.Group>
            <MenuRow
              icon={TagIcon}
              label={t('channelSections.newPersonalSection')}
              onSelect={() =>
                fireAndForget(rail.createLabel([], 'personal'), 'channels-view')
              }
            />
            <Show when={rail.canShareSections()}>
              <MenuRow
                icon={TagIcon}
                label={t('channelSections.newTeamSection')}
                onSelect={() =>
                  fireAndForget(rail.createLabel([], 'team'), 'channels-view')
                }
              />
            </Show>
            <MenuRow
              icon={FilterIcon}
              label={t('channelSections.newSmartSection')}
              onSelect={() =>
                fireAndForget(rail.createSmartTag(), 'channels-view')
              }
            />
            <Show when={rail.canShareSections()}>
              <MenuRow
                icon={FilterIcon}
                label={t('channelSections.newTeamSmartSection')}
                onSelect={() =>
                  fireAndForget(rail.createSmartTag('team'), 'channels-view')
                }
              />
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

/** Moving a personal assignment never changes a shared assignment. */
export function ChannelLabelMenuItems(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const labels = () =>
    rail
      .labels()
      .filter((label) => !label.rule && canLabelChannel(props.channel, label));
  const current = (shared: boolean) =>
    labels().find(
      (label) =>
        Boolean(label.teamId) === shared &&
        label.channelIds.includes(props.channel.id)
    );
  return (
    <Show
      when={
        rail.channelTagsEnabled() &&
        canLabelChannel(props.channel) &&
        rail.labelsAvailable()
      }
    >
      <For
        each={labels().filter((label) =>
          label.channelIds.includes(props.channel.id)
        )}
      >
        {(label) => (
          <MenuItem
            icon={TagSimpleIcon}
            text={t('channelSections.removeFrom', { name: label.name })}
            onClick={() =>
              rail.setChannelLabel(props.channel.id, undefined, label.id)
            }
          />
        )}
      </For>
      <ContextMenu.Sub>
        <SubTrigger icon={TagIcon} text={t('channelSections.addToSection')} />
        <ContextMenuContent
          submenu
          class="min-w-56 max-w-[22rem] text-xs text-ink-muted"
        >
          <For each={[false, true]}>
            {(shared) => (
              <Show
                when={
                  !shared ||
                  (rail.canShareSections() &&
                    props.channel.channelType === 'team')
                }
              >
                <div class="px-2 py-1 text-xs text-ink-extra-muted">
                  {shared
                    ? t('channelSections.shared')
                    : t('channelSections.personal')}
                </div>
                <ContextMenu.RadioGroup
                  value={current(shared)?.id ?? ''}
                  onChange={(labelId) =>
                    rail.setChannelLabel(props.channel.id, labelId)
                  }
                >
                  <For
                    each={labels().filter(
                      (label) => Boolean(label.teamId) === shared
                    )}
                  >
                    {(label) => (
                      <MenuItem
                        selectorType="radio"
                        value={label.id}
                        groupValue={current(shared)?.id ?? ''}
                        text={label.name}
                      />
                    )}
                  </For>
                </ContextMenu.RadioGroup>
                <MenuItem
                  icon={PlusIcon}
                  text={t('channelSections.newSection')}
                  onClick={() =>
                    fireAndForget(
                      rail.createLabel(
                        [props.channel.id],
                        shared ? 'team' : 'personal'
                      ),
                      'channels-view'
                    )
                  }
                />
                <MenuSeparator />
              </Show>
            )}
          </For>
        </ContextMenuContent>
      </ContextMenu.Sub>
    </Show>
  );
}
