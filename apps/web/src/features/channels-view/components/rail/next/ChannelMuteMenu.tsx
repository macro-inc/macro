import { formatLocale, t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { isMutedItem } from '@entity/utils/notification';
import BellIcon from '@icon/system/regular/bell.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  formatSnoozeDeadline,
  snoozePresets,
} from '@notifications/core/snooze';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import { useAvailableSectionChannelsQuery } from '@queries/channel-labels/channel-labels';
import { queryReadyGate } from '@queries/gate';
import {
  useBulkNotificationPreferencesMutation,
  useMutedEntitiesQuery,
} from '@queries/notification/unsubscribes';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ChannelSectionKey } from '../../../types';
import { useChannelsRail } from '../ChannelsRailContext';

export function presetTranslationKey(id: string) {
  return match(id)
    .with('30-minutes', () => 'channelSections.muteFor30Minutes' as const)
    .with('1-hour', () => 'channelSections.muteFor1Hour' as const)
    .with('3-hours', () => 'channelSections.muteFor3Hours' as const)
    .with('morning', () => 'channelSections.muteUntilMorning' as const)
    .with('weekend', () =>
      new Date().getDay() === 0 || new Date().getDay() >= 5
        ? ('channelSections.muteForWeekend' as const)
        : ('channelSections.muteUntilMonday' as const)
    )
    .otherwise(() => 'channelSections.muteForWeek' as const);
}
/** The same existing snooze presets and custom picker for channels and sections. */
export function ChannelMuteMenu(props: {
  label: string;
  unmuteLabel: string;
  muted: boolean;
  disabled?: boolean;
  onMute: (muted: boolean) => void;
  onSnooze: (until?: Date) => void;
}) {
  return (
    <Show
      when={!props.muted}
      fallback={
        <MenuItem
          icon={BellIcon}
          text={props.unmuteLabel}
          disabled={props.disabled}
          onClick={() => props.onMute(false)}
        />
      }
    >
      <ContextMenu.Sub>
        <SubTrigger text={props.label} disabled={props.disabled} />
        <ContextMenuContent submenu class="min-w-64">
          <MenuItem
            text={t('channelSections.muteIndefinitely')}
            onClick={() => props.onMute(true)}
          />
          <MenuSeparator />
          <For each={snoozePresets(new Date())}>
            {(preset) => {
              return (
                <ContextMenu.Item
                  class={MENU_ITEM_CLASS}
                  onSelect={() => props.onSnooze(preset.until)}
                >
                  <span class="min-w-0 flex-1 truncate">
                    {t(presetTranslationKey(preset.id))}
                  </span>
                  <span class="ml-auto shrink-0 text-right text-xs whitespace-nowrap text-ink-extra-muted">
                    {formatSnoozeDeadline(preset.until, formatLocale())}
                  </span>
                </ContextMenu.Item>
              );
            }}
          </For>
          <MenuSeparator />
          <MenuItem
            text={t('channelSections.customMute')}
            onClick={() => props.onSnooze()}
          />
        </ContextMenuContent>
      </ContextMenu.Sub>
    </Show>
  );
}

export function ChannelRowMuteMenu(props: { channelId: string }) {
  const userId = useUserId();
  const mutation = useBulkNotificationPreferencesMutation();
  const muted = useMutedEntitiesQuery();
  const item = () => ({
    item_type: 'channel' as const,
    item_id: props.channelId,
  });
  const save = async (value: boolean, until?: Date) => {
    const actorId = userId();
    if (!actorId) return;
    const result = await mutation.mutateAsync({
      actorId,
      items: [item()],
      muted: value,
      snoozedUntil: until?.toISOString(),
    });
    if (userId() === actorId && result.failed.length)
      toast.failure(t('channelSections.notificationsFailed'));
  };
  return (
    <ChannelMuteMenu
      label={t('channelSections.muteChannel')}
      unmuteLabel={t('channelSections.unmuteChannel')}
      muted={queryReadyGate(muted) && isMutedItem(muted.data ?? [], item())}
      disabled={mutation.isPending}
      onMute={(value) => fireAndForget(save(value), 'channels-view')}
      onSnooze={(until) =>
        until
          ? fireAndForget(save(true, until), 'channels-view')
          : openSnoozeNotifications([item()])
      }
    />
  );
}

export function SectionMuteMenu(props: { section: ChannelSectionKey }) {
  const rail = useChannelsRail();
  const muted = useMutedEntitiesQuery();
  const channels = useAvailableSectionChannelsQuery(rail.sectionsEnabled);
  const ids = () => {
    if (props.section === 'favorites')
      return rail
        .favorites()
        .filter((favorite) => favorite.entityType === 'channel')
        .map((favorite) => favorite.entityId);
    if (props.section.startsWith('label:'))
      return (
        rail.labels().find((label) => `label:${label.id}` === props.section)
          ?.channelIds ?? []
      );
    if (!queryReadyGate(channels)) return [];
    return (channels.data ?? [])
      .filter((channel) => {
        if (!channel.is_participant) return false;
        if (props.section === 'team_channels')
          return channel.channel_type === 'team';
        if (props.section === 'direct_messages')
          return channel.channel_type === 'direct_message';
        return (
          channel.channel_type !== 'team' &&
          channel.channel_type !== 'direct_message'
        );
      })
      .map((channel) => channel.id);
  };
  const allMuted = () =>
    queryReadyGate(muted) &&
    ids().length > 0 &&
    ids().every((id) =>
      isMutedItem(muted.data ?? [], { item_type: 'channel', item_id: id })
    );
  return (
    <ChannelMuteMenu
      label={t('channelSections.muteAllChannels')}
      unmuteLabel={t('channelSections.unmuteAllChannels')}
      muted={allMuted()}
      disabled={rail.sectionNotificationsDisabled(props.section)}
      onMute={(value) =>
        fireAndForget(rail.muteSection(props.section, value), 'channels-view')
      }
      onSnooze={(until) =>
        fireAndForget(rail.snoozeSection(props.section, until), 'channels-view')
      }
    />
  );
}
