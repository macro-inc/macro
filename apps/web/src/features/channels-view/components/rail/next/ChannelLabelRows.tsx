import { ViewSidebar } from '@app/components/view-shell';
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
import UsersIcon from '@icon/system/regular/users.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { Badge, Button, Tooltip } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  canAssignChannel,
  canLabelChannel,
} from '../../../core/channel-label-eligibility';
import { ChannelLabelMenuItems as OriginalChannelLabelMenuItems } from '../ChannelLabelRows';
import { rowKeyForLabel, useChannelsRail } from '../ChannelsRailContext';
import { useChannelRailLabelState } from '../hooks/useChannelRailState';
import { ChannelSectionEmptyState } from './ChannelSectionEmptyState';
import { ChannelSectionHeading } from './ChannelSectionHeading';
import {
  ChannelSectionContextMenu,
  ChannelSectionDropdown,
} from './ChannelSectionMenu';

/** A custom section with the same heading and controls as built-in sections. */
export function ChannelLabelRow(props: {
  label: ChannelLabel;
  dragHandle?: JSX.Element;
}) {
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
        tooltip={
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
        dragHandle={props.dragHandle}
        badge={
          <Show when={props.label.teamId}>
            <Tooltip
              as="span"
              class="shrink-0"
              label={t('channelSections.sharedSectionHint')}
            >
              <span class="hidden @[16rem]/rail-section:inline-flex">
                <Badge variant="secondary" size="xs">
                  {t('channelSections.sharedShort')}
                </Badge>
              </span>
              <UsersIcon
                class="size-3.5 @[16rem]/rail-section:hidden"
                aria-label={t('channelSections.sharedShort')}
              />
            </Tooltip>
          </Show>
        }
      >
        <Show when={!props.label.rule}>
          <ViewSidebar.Control
            variant="ghost"
            size="icon-sm"
            aria-label={t('channelSections.addChannelsTo', {
              name: props.label.name,
            })}
            tooltip={t('channelSections.addChannels')}
            disabled={!rail.labelsAvailable()}
            onClick={() =>
              fireAndForget(
                rail.addChannelsToLabel(props.label),
                'channels-view'
              )
            }
          >
            <PlusIcon class="size-3.5" />
          </ViewSidebar.Control>
        </Show>
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

export function ChannelLabelEmptyState(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const section = () => rowKeyForLabel(props.label.id);
  const unreadOnly = () => rail.sectionPreferences(section()).unreadOnly;
  const message = () => {
    if (unreadOnly()) return t('channelSections.noUnreadConversations');

    if (props.label.rule) return t('channelSections.emptySmartSection');

    return t('channelSections.emptySection');
  };

  const actionLabel = () => {
    if (unreadOnly()) return t('channelSections.showAllChannels');

    if (props.label.rule) return t('channelSections.editRule');

    return t('channelSections.addChannels');
  };

  const act = () => {
    if (unreadOnly()) {
      rail.setSectionPreferences(section(), { unreadOnly: false });
      return;
    }

    const action = props.label.rule
      ? rail.renameLabel(props.label)
      : rail.addChannelsToLabel(props.label);
    fireAndForget(action, 'channels-view');
  };

  return (
    <ChannelSectionEmptyState>
      <p>{message()}</p>
      <Button
        variant="ghost"
        size="xs"
        class="mt-1"
        disabled={!rail.labelsAvailable()}
        onClick={act}
      >
        {actionLabel()}
      </Button>
    </ChannelSectionEmptyState>
  );
}

function ChannelLabelActions(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();

  return (
    <>
      <MenuSeparator />
      <MenuGroup>
        <Show when={!props.label.rule}>
          <MenuItem
            icon={PlusIcon}
            text={t('channelSections.addChannels')}
            disabled={!rail.labelsAvailable()}
            onClick={() =>
              fireAndForget(
                rail.addChannelsToLabel(props.label),
                'channels-view'
              )
            }
          />
        </Show>
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
      .filter(
        (label) =>
          !label.rule &&
          (label.channelIds.includes(props.channel.id) ||
            canAssignChannel(props.channel, label))
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
                      onChange={(checked) => {
                        if (checked) {
                          rail.setChannelLabel(props.channel.id, label.id);
                          return;
                        }

                        rail.setChannelLabel(
                          props.channel.id,
                          undefined,
                          label.id
                        );
                      }}
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
