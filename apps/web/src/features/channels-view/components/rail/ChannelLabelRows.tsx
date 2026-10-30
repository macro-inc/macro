import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CaretUpIcon from '@icon/system/regular/caret-up.svg';
import ChecksIcon from '@icon/system/regular/checks.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import PencilSimpleIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { Badge, cn, Dropdown } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import {
  type ChannelLabelDropData,
  rowKeyForLabel,
  useChannelsRail,
} from './ChannelsRailContext';
import { ChannelSectionHeading } from './ChannelsRailSection';
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

/** A custom section with the same heading and controls as built-in sections. */
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
        'group/channel-label relative min-w-0 rounded-lg',
        isDropTarget() && 'bg-selected'
      )}
    >
      <ChannelSectionHeading
        id={state().domId}
        label={props.label.name}
        title={
          props.label.rule
            ? t('channelLabels.nameContains', {
                text: props.label.rule.contains,
              })
            : props.label.name
        }
        open={state().open}
        focused={state().focused}
        unreadCount={state().unreadCount}
        onToggle={() => rail.activateRow(rowKeyForLabel(props.label.id))}
        badge={
          <Show when={props.label.teamId}>
            <Badge variant="secondary" size="xs">
              {t('channelSections.sharedShort')}
            </Badge>
          </Show>
        }
      >
        <Dropdown placement="bottom-end">
          <Dropdown.Trigger
            aria-label={t('channelSections.optionsFor', {
              name: props.label.name,
            })}
            tooltip={t('channelSections.optionsFor', {
              name: props.label.name,
            })}
            as={ViewSidebar.Control}
            variant="ghost"
            size="icon-sm"
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
            <ChannelLabelActions label={props.label} />
          </Dropdown.Content>
        </Dropdown>
      </ChannelSectionHeading>
      <Show when={state().open && props.label.channelIds.length === 0}>
        <p class="px-2 pb-2 text-xs text-ink-extra-muted">
          {props.label.rule
            ? t('channelSections.emptySmartSection')
            : t('channelSections.emptySection')}
        </p>
      </Show>
    </div>
  );
}

function ChannelLabelActions(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  return (
    <>
      <Dropdown.Group>
        <MenuRow
          icon={PencilSimpleIcon}
          label={
            props.label.rule
              ? t('channelLabels.editSmartLabel')
              : t('channelSections.renameSection')
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
          icon={rail.isLabelOpen(props.label.id) ? CaretUpIcon : CaretDownIcon}
          label={
            rail.isLabelOpen(props.label.id)
              ? t('channelSections.collapseSection')
              : t('channelSections.expandSection')
          }
          onSelect={() => rail.toggleLabel(props.label.id)}
        />
        <MenuRow
          icon={ChecksIcon}
          label={t('channelLabels.markAllAsRead')}
          disabled={rail.labelUnreadCount(props.label) === 0}
          onSelect={() => rail.markLabelRead(props.label)}
        />
      </Dropdown.Group>
      <Dropdown.Separator />
      <Dropdown.Group>
        <MenuRow
          icon={TrashIcon}
          label={t('channelSections.deleteSection')}
          onSelect={() =>
            fireAndForget(rail.deleteLabel(props.label), 'channels-view')
          }
        />
      </Dropdown.Group>
    </>
  );
}

/** One entry point for creating, editing, and expanding sidebar sections. */
export function ChannelsSectionsMenu() {
  const rail = useChannelsRail();
  const setExpanded = (expanded: boolean) => {
    for (const group of [
      'favorites',
      'team_channels',
      'channels',
      'direct_messages',
    ] as const) {
      if (rail.isGroupOpen(group) !== expanded) rail.toggleGroup(group);
    }
    for (const label of rail.labels()) {
      if (rail.isLabelOpen(label.id) !== expanded) rail.toggleLabel(label.id);
    }
  };
  return (
    <Show when={rail.channelTagsEnabled() && rail.labelsAvailable()}>
      <Dropdown placement="bottom-end">
        <Dropdown.Trigger
          aria-label={t('channelSections.manageSections')}
          tooltip={t('channelSections.manageSections')}
          as={ViewSidebar.Control}
          variant="ghost"
          size="icon-sm"
        >
          <SlidersIcon class="size-3.5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          class="min-w-56 max-h-[70vh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"]'))
              event.preventDefault();
          }}
        >
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
          <Show when={rail.labels().length > 0}>
            <Dropdown.Separator />
            <Dropdown.Group>
              <Dropdown.GroupLabel>
                {t('channelSections.sections')}
              </Dropdown.GroupLabel>
              <For each={rail.labels()}>
                {(label) => (
                  <Dropdown.Sub>
                    <Dropdown.SubTrigger>
                      <span class="min-w-0 flex-1 truncate">{label.name}</span>
                      <span class="text-xs text-ink-extra-muted">
                        {label.teamId
                          ? t('channelSections.sharedShort')
                          : t('channelSections.personal')}
                      </span>
                      <CaretRightIcon class="size-3.5 shrink-0" />
                    </Dropdown.SubTrigger>
                    <Dropdown.SubContent class="min-w-48">
                      <ChannelLabelActions label={label} />
                    </Dropdown.SubContent>
                  </Dropdown.Sub>
                )}
              </For>
            </Dropdown.Group>
          </Show>
          <Dropdown.Separator />
          <Dropdown.Group>
            <MenuRow
              icon={CaretDownIcon}
              label={t('channelSections.expandAllSections')}
              onSelect={() => setExpanded(true)}
            />
            <MenuRow
              icon={CaretUpIcon}
              label={t('channelSections.collapseAllSections')}
              onSelect={() => setExpanded(false)}
            />
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
