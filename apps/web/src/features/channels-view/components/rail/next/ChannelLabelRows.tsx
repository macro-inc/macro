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
import { InlineSectionDraft } from './InlineSectionDraft';
import { SectionChannelsPicker } from './SectionChannelsDialog';
import { SectionRuleEditor } from './SectionRuleEditor';

type SectionEditor = 'add' | 'match';

function SectionEditorPopover(props: {
  label: ChannelLabel;
  mode?: SectionEditor;
  onClose: () => void;
  children: JSX.Element;
}) {
  const rail = useChannelsRail();
  return (
    <Popover
      open={Boolean(props.mode)}
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
            {t(
              props.mode === 'add'
                ? 'channelSections.addChannels'
                : 'channelSections.matchByName'
            )}
          </Popover.Title>
          <Show
            when={props.mode === 'add'}
            fallback={
              <SectionRuleEditor
                label={props.label}
                onSave={(rule) =>
                  rail.updateSection(props.label, props.label.name, rule)
                }
                onClose={props.onClose}
              />
            }
          >
            <SectionChannelsPicker
              label={props.label}
              onConfirm={(ids) => rail.addLabelChannels(props.label, ids)}
              onClose={props.onClose}
            />
          </Show>
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
  onEdit: (mode: SectionEditor) => void;
}) {
  const rail = useChannelsRail();
  return (
    <>
      <MenuGroup>
        <MenuItem
          icon={PencilIcon}
          text={t('channelSections.renameSection')}
          onClick={() =>
            fireAndForget(rail.renameLabel(props.label), 'channels-view')
          }
        />
        <Show when={!props.label.rule}>
          <MenuItem
            icon={PlusIcon}
            text={t('channelSections.addChannels')}
            disabled={!rail.labelsAvailable()}
            onClick={() => props.onEdit('add')}
          />
        </Show>
        <MenuItem
          icon={FunnelIcon}
          text={t('channelSections.matchByName')}
          disabled={!rail.labelsAvailable()}
          onClick={() => props.onEdit('match')}
        />
      </MenuGroup>
      <MenuSeparator />
      <SectionVisibilityMenu label={props.label} />
    </>
  );
}

function DeleteSectionItem(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  return (
    <>
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
    </>
  );
}

export function ChannelLabelRow(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const state = useChannelRailLabelState(() => props.label);
  const [editor, setEditor] = createSignal<SectionEditor>();
  const draft = () => {
    const current = rail.sectionDraft();
    return current?.existing?.id === props.label.id ? current : undefined;
  };
  return (
    <Show
      when={draft()}
      fallback={
        <SectionEditorPopover
          label={props.label}
          mode={editor()}
          onClose={() => setEditor(undefined)}
        >
          <ChannelSectionContextMenu
            section={rowKeyForLabel(props.label.id)}
            before={
              <ChannelLabelActions label={props.label} onEdit={setEditor} />
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
              <Show when={!props.label.rule}>
                <ViewSidebar.Control
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('channelSections.addChannelsTo', {
                    name: props.label.name,
                  })}
                  tooltip={t('channelSections.addChannels')}
                  disabled={!rail.labelsAvailable()}
                  onClick={() => setEditor('add')}
                >
                  <PlusIcon class="size-3.5" />
                </ViewSidebar.Control>
              </Show>
              <ChannelSectionDropdown
                section={rowKeyForLabel(props.label.id)}
                label={props.label.name}
                before={
                  <ChannelLabelActions label={props.label} onEdit={setEditor} />
                }
              >
                <DeleteSectionItem label={props.label} />
              </ChannelSectionDropdown>
            </ChannelSectionHeading>
          </ChannelSectionContextMenu>
        </SectionEditorPopover>
      }
    >
      {(draft) => (
        <InlineSectionDraft
          label={props.label}
          scope={draft().scope}
          canShare={rail.canShareSections()}
          onSave={rail.saveSectionDraft}
          onCancel={rail.cancelSectionDraft}
        />
      )}
    </Show>
  );
}

export function ChannelLabelEmptyState(props: { label: ChannelLabel }) {
  const rail = useChannelsRail();
  const [editor, setEditor] = createSignal<SectionEditor>();
  const unreadOnly = () =>
    rail.sectionPreferences(rowKeyForLabel(props.label.id)).unreadOnly;
  return (
    <SectionEditorPopover
      label={props.label}
      mode={editor()}
      onClose={() => setEditor(undefined)}
    >
      <ChannelSectionEmptyState>
        <Show
          when={unreadOnly()}
          fallback={
            <>
              <Show when={!props.label.rule}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!rail.labelsAvailable()}
                  onClick={() => setEditor('add')}
                >
                  <PlusIcon class="size-3.5" />
                  {t('channelSections.addChannels')}
                </Button>
              </Show>
              <Button
                variant="ghost"
                size="sm"
                disabled={!rail.labelsAvailable()}
                onClick={() => setEditor('match')}
              >
                <FunnelIcon class="size-3.5" />
                {t('channelSections.matchByName')}
              </Button>
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
          label.channelIds.includes(props.channel.id) ||
          canAssignChannel(props.channel, label)
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
        <ContextMenuContent submenu class="min-w-56 max-w-[22rem]">
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
                  disabled={automatic()}
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
