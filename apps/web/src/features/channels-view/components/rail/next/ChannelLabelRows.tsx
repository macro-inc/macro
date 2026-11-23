import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult } from '@core/util/result';
import type { ChannelEntity } from '@entity';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { Popover } from '@kobalte/core/popover';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { Button, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
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
import { SectionChannelsPicker } from './SectionChannelsDialog';

function SectionEditorPopover(props: {
  label: ChannelLabel;
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
}) {
  const rail = useChannelsRail();
  return (
    <Popover
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      placement="right-start"
      gutter={8}
      modal={false}
      fitViewport
    >
      <Popover.Anchor as="div">{props.children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content class="menu-surface z-action-menu w-80 max-w-[calc(100vw-1rem)] outline-none">
          <Popover.Title class="sr-only">
            {t('channelSections.addChannels')}
          </Popover.Title>
          <SectionChannelsPicker
            label={props.label}
            onConfirm={(ids) => rail.addLabelChannels(props.label, ids)}
            onClose={props.onClose}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function SectionVisibilityMenu(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const team = useCurrentTeamQuery();
  const teamName = () =>
    queryReadyGate(team)
      ? (team.data?.team.name ?? t('channelSections.team_channels'))
      : t('channelSections.team_channels');
  const text = (
    <span class="flex min-w-0 items-center gap-4">
      <span class="flex-1">{t('channelSections.visibleTo')}</span>
      <span class="truncate text-xs text-ink-extra-muted">
        {props.label.teamId ? teamName() : t('channelSections.onlyMe')}
      </span>
    </span>
  );
  const saveScope = async (scope: 'personal' | 'team') => {
    const result = await catchToResult(() =>
      rail.updateSection(
        props.label,
        props.label.name,
        props.label.rule ?? undefined,
        scope
      )
    );
    if (result.isErr()) toast.failure(t('channelSections.saveSectionFailed'));
  };
  const setScope = (scope: 'personal' | 'team') =>
    fireAndForget(saveScope(scope), 'channels-view');
  return (
    <ContextMenu.Sub>
      <SubTrigger
        icon={UsersIcon}
        text={text}
        disabled={!rail.labelsAvailable()}
      />
      <ContextMenuContent submenu class="min-w-52">
        <MenuItem
          selectorType="checkbox"
          checked={!props.label.teamId}
          text={t('channelSections.onlyMe')}
          onChange={(checked) => {
            if (checked && props.label.teamId) setScope('personal');
          }}
        />
        <Show when={rail.canShareSections()}>
          <MenuItem
            selectorType="checkbox"
            checked={Boolean(props.label.teamId)}
            text={teamName()}
            onChange={(checked) => {
              if (checked && !props.label.teamId) setScope('team');
            }}
          />
        </Show>
      </ContextMenuContent>
    </ContextMenu.Sub>
  );
}

function ChannelLabelActions(props: {
  label: ChannelLabel;
  onAdd: () => void;
}) {
  const rail = useChannelsRail();
  return (
    <Show when={rail.canEditSection(props.label)}>
      <MenuGroup>
        <MenuItem
          icon={PencilIcon}
          text={t('channelSections.editSection')}
          onClick={() =>
            fireAndForget(rail.renameLabel(props.label), 'channels-view')
          }
        />
        <Show when={!props.label.rule}>
          <MenuItem
            icon={PlusIcon}
            text={t('channelSections.addChannels')}
            disabled={!rail.labelsAvailable()}
            onClick={props.onAdd}
          />
        </Show>
      </MenuGroup>
      <Show when={rail.canChangeSectionScope(props.label)}>
        <MenuSeparator />
        <SectionVisibilityMenu label={props.label} />
      </Show>
    </Show>
  );
}

function DeleteSectionItem(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  return (
    <Show when={rail.canEditSection(props.label)}>
      <MenuSeparator />
      <MenuItem
        icon={TrashIcon}
        text={t(
          props.label.teamId
            ? 'channelSections.deleteForEveryone'
            : 'channelSections.deleteSection'
        )}
        class="text-failure-ink"
        onClick={() =>
          fireAndForget(rail.deleteLabel(props.label), 'channels-view')
        }
      />
    </Show>
  );
}

export function ChannelLabelRow(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const state = useChannelRailLabelState(() => props.label);
  const [editorOpen, setEditorOpen] = createSignal(false);
  return (
    <SectionEditorPopover
      label={props.label}
      open={editorOpen()}
      onClose={() => setEditorOpen(false)}
    >
      <ChannelSectionContextMenu
        section={rowKeyForLabel(props.label.id)}
        before={
          <ChannelLabelActions
            label={props.label}
            onAdd={() => setEditorOpen(true)}
          />
        }
        actions={<DeleteSectionItem label={props.label} />}
      >
        <ChannelSectionHeading
          id={state().domId}
          label={props.label.name}
          tooltip={props.label.name}
          open={state().open}
          focused={state().focused}
          unreadCount={state().unreadCount}
          onToggle={() => rail.activateRow(rowKeyForLabel(props.label.id))}
          badge={
            <>
              <Show when={props.label.teamId}>
                <Tooltip
                  as="span"
                  label={t('channelSections.sharedSectionHint')}
                  class="shrink-0"
                >
                  <UsersIcon class="size-3.5" />
                </Tooltip>
              </Show>
              <Show when={props.label.rule}>
                <Tooltip
                  as="span"
                  label={t('channelLabels.nameContains', {
                    text: props.label.rule?.contains ?? '',
                  })}
                  class="shrink-0"
                >
                  <FunnelIcon class="size-3.5" />
                </Tooltip>
              </Show>
            </>
          }
        >
          <Show when={!props.label.rule && rail.canEditSection(props.label)}>
            <ViewSidebar.Control
              variant="ghost"
              size="icon-sm"
              aria-label={t('channelSections.addChannelsTo', {
                name: props.label.name,
              })}
              tooltip={t('channelSections.addChannels')}
              disabled={!rail.labelsAvailable()}
              onClick={() => setEditorOpen(true)}
            >
              <PlusIcon class="size-3.5" />
            </ViewSidebar.Control>
          </Show>
          <ChannelSectionDropdown
            section={rowKeyForLabel(props.label.id)}
            label={props.label.name}
            before={
              <ChannelLabelActions
                label={props.label}
                onAdd={() => setEditorOpen(true)}
              />
            }
          >
            <DeleteSectionItem label={props.label} />
          </ChannelSectionDropdown>
        </ChannelSectionHeading>
      </ChannelSectionContextMenu>
    </SectionEditorPopover>
  );
}

export function ChannelLabelEmptyState(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const [editorOpen, setEditorOpen] = createSignal(false);
  const unreadOnly = () =>
    rail.sectionPreferences(rowKeyForLabel(props.label.id)).unreadOnly;
  return (
    <SectionEditorPopover
      label={props.label}
      open={editorOpen()}
      onClose={() => setEditorOpen(false)}
    >
      <ChannelSectionEmptyState>
        <Show
          when={unreadOnly()}
          fallback={
            <>
              <p class="font-medium text-ink">
                {t(
                  props.label.rule
                    ? 'channelSections.emptySmartSection'
                    : 'channelSections.emptySection'
                )}
              </p>
              <Show when={rail.canEditSection(props.label)}>
                <Show when={!props.label.rule}>
                  <p>{t('channelSections.emptySectionHint')}</p>
                </Show>
                <div class="flex flex-wrap items-center gap-1">
                  <Show when={!props.label.rule}>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => setEditorOpen(true)}
                    >
                      {t('channelSections.addChannels')}
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      fireAndForget(
                        rail.renameLabel(props.label),
                        'channels-view'
                      )
                    }
                  >
                    {t('channelSections.editSection')}
                  </Button>
                </div>
              </Show>
            </>
          }
        >
          <p>{t('channelSections.noUnreadConversations')}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              rail.setSectionPreferences(rowKeyForLabel(props.label.id), {
                unreadOnly: false,
              })
            }
          >
            {t('channelSections.showAllChannels')}
          </Button>
        </Show>
      </ChannelSectionEmptyState>
    </SectionEditorPopover>
  );
}

function SectionMenuItems(props: { channel: ChannelEntity }) {
  const rail = useChannelsRail();
  const labels = () =>
    rail
      .labels()
      .filter(
        (label) =>
          rail.canEditSection(label) &&
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
      <ContextMenu.Sub>
        <SubTrigger icon={TagIcon} text={t('channelSections.addToSection')} />
        <ContextMenuContent
          submenu
          class="min-w-56 max-w-[22rem] max-h-[min(24rem,60dvh)] overflow-y-auto"
        >
          <For each={labels()}>
            {(label) => {
              const automatic = () => Boolean(label.rule);
              const labelText = (
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{label.name}</span>
                  <Show when={automatic()}>
                    <span class="text-xs text-ink-muted">
                      {t('channelSections.matchedByName')}
                    </span>
                  </Show>
                </span>
              );
              return (
                <MenuItem
                  selectorType="checkbox"
                  checked={label.channelIds.includes(props.channel.id)}
                  disabled={automatic() || !rail.canEditSection(label)}
                  text={labelText}
                  onChange={(checked) =>
                    rail.setChannelLabel(
                      props.channel.id,
                      checked ? label.id : undefined,
                      label.id
                    )
                  }
                />
              );
            }}
          </For>
          <MenuSeparator />
          <MenuItem
            icon={PlusIcon}
            text={t('channelSections.newSection')}
            onClick={() =>
              fireAndForget(
                rail.createLabel([props.channel.id]),
                'channels-view'
              )
            }
          />
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
