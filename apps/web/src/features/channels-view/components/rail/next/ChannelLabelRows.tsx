import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuGroup,
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
import { Badge, cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { canLabelChannel } from '../../../core/channel-label-eligibility';
import { ChannelLabelMenuItems as OriginalChannelLabelMenuItems } from '../ChannelLabelRows';
import {
  type ChannelLabelDropData,
  rowKeyForLabel,
  useChannelsRail,
} from '../ChannelsRailContext';
import { useChannelRailLabelState } from '../hooks/useChannelRailState';
import { ChannelSectionHeading } from './ChannelSectionHeading';
import {
  ChannelSectionContextMenu,
  ChannelSectionDropdown,
} from './ChannelSectionMenu';

/** One drop target and highlight around the full custom section. */
export function ChannelLabelDropZone(props: {
  label: ChannelLabel;
  children: JSX.Element;
}) {
  const rail = useChannelsRail();
  const droppable = createDroppable(
    `${rail.railId}:channel-label:label:${props.label.id}`,
    {
      dragType: 'channel-label-target',
      dndScope: rail.railId,
      get target() {
        return {
          kind: props.label.rule ? ('smart-tag' as const) : ('label' as const),
          labelId: props.label.id,
        };
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
        'group/channel-label relative min-w-0 shrink-0 rounded-lg',
        isDropTarget() && 'bg-selected ring-1 ring-inset ring-accent'
      )}
    >
      {props.children}
    </div>
  );
}

/** A custom section with the same heading and controls as built-in sections. */
export function ChannelLabelRow(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const state = useChannelRailLabelState(() => props.label);
  return (
    <ChannelSectionContextMenu
      section={rowKeyForLabel(props.label.id)}
      actions={<ChannelLabelActions label={props.label} />}
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
    </ChannelSectionContextMenu>
  );
}

function ChannelLabelActions(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <MenuItem
          icon={PencilSimpleIcon}
          text={
            props.label.rule
              ? t('channelLabels.editSmartLabel')
              : t('channelSections.renameSection')
          }
          onClick={() =>
            fireAndForget(rail.renameLabel(props.label), 'channels-view')
          }
        />
        <MenuItem
          icon={ChecksIcon}
          text={t('channelLabels.markAllAsRead')}
          disabled={rail.labelUnreadCount(props.label) === 0}
          onClick={() => rail.markLabelRead(props.label)}
        />
      </MenuGroup>
      <MenuSeparator />
      <MenuItem
        icon={TrashIcon}
        text={t('channelSections.deleteSection')}
        class="text-failure"
        onClick={() =>
          fireAndForget(rail.deleteLabel(props.label), 'channels-view')
        }
      />
    </>
  );
}

/** Moving a personal assignment never changes a shared assignment. */
function SectionMenuItems(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const labels = () =>
    rail
      .labels()
      .filter((label) => !label.rule && canLabelChannel(props.channel, label));
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
                <For
                  each={labels().filter(
                    (label) => Boolean(label.teamId) === shared
                  )}
                >
                  {(label) => (
                    <MenuItem
                      selectorType="checkbox"
                      checked={label.channelIds.includes(props.channel.id)}
                      text={label.name}
                      onChange={(checked) =>
                        checked
                          ? rail.setChannelLabel(props.channel.id, label.id)
                          : rail.setChannelLabel(
                              props.channel.id,
                              undefined,
                              label.id
                            )
                      }
                    />
                  )}
                </For>
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

export function ChannelLabelMenuItems(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  return (
    <Show
      when={rail.sectionsEnabled()}
      fallback={<OriginalChannelLabelMenuItems channel={props.channel} />}
    >
      <SectionMenuItems channel={props.channel} />
    </Show>
  );
}
