import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ChannelEntity } from '@entity';
import ChecksIcon from '@icon/system/regular/checks.svg';
import PencilSimpleIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { createDroppable } from '@thisbeyond/solid-dnd';
import { Badge, cn, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import { ChannelSectionDropdown } from './ChannelSectionMenu';
import {
  type ChannelLabelDropData,
  rowKeyForLabel,
  useChannelsRail,
} from './ChannelsRailContext';
import { ChannelSectionHeading } from './ChannelsRailSection';
import { useChannelRailLabelState } from './hooks/useChannelRailState';

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
  const unreadOnly = () =>
    rail.sectionPreferences(rowKeyForLabel(props.label.id)).unreadOnly;
  const hasVisibleChannels = () =>
    rail.list.items
      .all()
      .some(
        (row) => row.kind === 'conversation' && row.labelId === props.label.id
      );

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
        <ChannelSectionDropdown
          section={rowKeyForLabel(props.label.id)}
          label={props.label.name}
        >
          <ChannelLabelActions label={props.label} />
        </ChannelSectionDropdown>
      </ChannelSectionHeading>
      <Show
        when={
          state().open &&
          (props.label.channelIds.length === 0 ||
            (unreadOnly() && !hasVisibleChannels()))
        }
      >
        <p class="pr-2 pb-2 pl-4 text-xs text-ink-extra-muted">
          {unreadOnly()
            ? t('channelSections.noUnreadConversations')
            : props.label.rule
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
        <Dropdown.Item
          onSelect={() =>
            fireAndForget(rail.renameLabel(props.label), 'channels-view')
          }
        >
          <PencilSimpleIcon class="size-3.5 text-ink-muted" />
          {props.label.rule
            ? t('channelLabels.editSmartLabel')
            : t('channelSections.renameSection')}
        </Dropdown.Item>
        <Dropdown.Item
          disabled={rail.labelUnreadCount(props.label) === 0}
          onSelect={() => rail.markLabelRead(props.label)}
        >
          <ChecksIcon class="size-3.5 text-ink-muted" />
          {t('channelLabels.markAllAsRead')}
        </Dropdown.Item>
      </Dropdown.Group>
      <Dropdown.Group>
        <Dropdown.Item
          class="text-failure"
          onSelect={() =>
            fireAndForget(rail.deleteLabel(props.label), 'channels-view')
          }
        >
          <TrashIcon class="size-3.5" />
          {t('channelSections.deleteSection')}
        </Dropdown.Item>
      </Dropdown.Group>
    </>
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
