import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { formatLocale, t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  enableChannelNotificationSettings,
  enableChatSidebarSections,
} from '@core/constant/featureFlags';
import { catchToResult } from '@core/util/result';
import { isMentionsOnlyItem } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import {
  useChannelNotificationSettingsMutation,
  useChannelNotificationSettingsQuery,
  useSectionNotificationSettingsMutation,
  useSectionNotificationSettingsQuery,
} from '@queries/notification/notification-settings';
import { useMutedEntitiesQuery } from '@queries/notification/unsubscribes';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import type { SectionMute } from '@service-notification/generated/schemas/sectionMute';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  CHANNEL_NOTIFICATION_KINDS,
  type ChannelOwnSettings,
  changeForKinds,
  channelSectionOf,
  type EffectiveChannelNotifications,
  effectiveChannelNotifications,
  type NotificationPreset,
  type NotificationSectionKey,
  PRESET_KINDS,
  presetFor,
  type SectionChange,
  type SectionSettings,
  sectionConflicts,
  sectionEnabledKinds,
  sectionKeyOf,
  sectionMuteActive,
  sectionsHoldingChannel,
  UNSET_CHANNEL_SETTINGS,
  UNSET_SECTION_SETTINGS,
} from '../core/channel-notification-settings';

export type ChannelNotificationLabel = {
  id: string;
  name: string;
  channelIds: readonly string[];
};

type Sources = {
  labels: Accessor<readonly ChannelNotificationLabel[]>;
  favoriteChannelIds: Accessor<ReadonlySet<string>>;
  /**
   * Load the records of channels with their own settings, which section
   * conflict checks need for their names and built-in sections.
   */
  resolveConflictChannels?: boolean;
};

export type ChannelNotificationView = EffectiveChannelNotifications & {
  preset: NotificationPreset;
  /** The preset the channel's sections give it. */
  inheritedPreset: NotificationPreset;
  /** The holding sections' names as a list, empty outside every section. */
  sectionNames: string;
};

export type SectionNotificationView = {
  enabled: ReadonlySet<ChannelNotificationKind>;
  preset: NotificationPreset;
  mute: SectionMute;
  muted: boolean;
};

/**
 * The viewer's channel and Chat section notification settings, resolved for
 * menus the way notification ingress resolves them, with their writes.
 */
export function createChannelNotificationSettings(sources: Sources) {
  const flag = useFeatureFlag(enableChannelNotificationSettings);
  const enabled = () => flag().enabled;
  const channelQuery = useChannelNotificationSettingsQuery(enabled);
  const sectionQuery = useSectionNotificationSettingsQuery(enabled);
  const mutedQuery = useMutedEntitiesQuery(undefined, enabled);
  const channelMutation = useChannelNotificationSettingsMutation();
  const sectionMutation = useSectionNotificationSettingsMutation();

  const channelSettings = createMemo(() => {
    const settings = new Map<string, ChannelOwnSettings>();
    if (!queryReadyGate(channelQuery)) return settings;
    for (const entry of channelQuery.data ?? []) {
      settings.set(entry.channelId, {
        enabled: entry.enabled ? new Set(entry.enabled) : undefined,
        overridesSectionMute: entry.overridesSectionMute,
      });
    }
    return settings;
  });

  const sectionSettings = createMemo(() => {
    const settings = new Map<NotificationSectionKey, SectionSettings>();
    if (!queryReadyGate(sectionQuery)) return settings;
    for (const entry of sectionQuery.data ?? []) {
      settings.set(sectionKeyOf(entry.section), {
        disabled: new Set(entry.disabled),
        mute: entry.mute,
      });
    }
    return settings;
  });

  /** Channels still on the legacy mentions-only level, which reads as their own settings. */
  const legacyMentionsOnlyIds = createMemo(() => {
    if (!queryReadyGate(mutedQuery)) return new Set<string>();
    return new Set(
      (mutedQuery.data ?? [])
        .filter(
          (item) =>
            item.item_type === 'channel' &&
            isMentionsOnlyItem(mutedQuery.data ?? [], item)
        )
        .map((item) => item.item_id)
    );
  });

  /** Channels with settings of their own, legacy mentions-only included. */
  const ownSettingsIds = createMemo(() => [
    ...new Set([...channelSettings().keys(), ...legacyMentionsOnlyIds()]),
  ]);
  // The rail's loaded pages may not hold these, so resolve them by id.
  const conflictChannels = useCachedChannelsByIds(
    ownSettingsIds,
    () => enabled() && sources.resolveConflictChannels === true
  );
  const conflictChannel = (channelId: string) =>
    conflictChannels.channels().find((channel) => channel.id === channelId);

  const sectionName = (key: NotificationSectionKey) =>
    match(key)
      .with('favorites', () => t('channelSections.favorites'))
      .with('direct_messages', () => t('channelSections.direct_messages'))
      .with('team_channels', () => t('channelSections.team_channels'))
      .otherwise(
        (label) =>
          sources.labels().find((entry) => `label:${entry.id}` === label)
            ?.name ?? t('channelSections.channels')
      );

  /**
   * A legacy mentions-only channel reads as its own settings with @mentions
   * alone; the server drops it once the channel's kinds change.
   */
  const ownSettings = (channelId: string): ChannelOwnSettings => {
    const own = channelSettings().get(channelId) ?? UNSET_CHANNEL_SETTINGS;
    if (own.enabled || !legacyMentionsOnlyIds().has(channelId)) return own;
    return { ...own, enabled: new Set(['channel_mention']) };
  };

  const listFormat = () =>
    new Intl.ListFormat(formatLocale(), { type: 'conjunction' });

  const channel = (
    channelId: string,
    channelType: string | undefined
  ): ChannelNotificationView => {
    const sections = sectionsHoldingChannel({
      channelId,
      channelType,
      labels: sources.labels(),
      favoriteChannelIds: sources.favoriteChannelIds(),
    });
    const effective = effectiveChannelNotifications({
      channel: ownSettings(channelId),
      sections,
      sectionSettings: sectionSettings(),
      now: new Date(),
    });
    return {
      ...effective,
      preset: presetFor(effective.enabled),
      inheritedPreset: presetFor(effective.inherited),
      sectionNames: listFormat().format(sections.map(sectionName)),
    };
  };

  /** The section's channels a change to it would not reach. */
  const conflictsFor = (key: NotificationSectionKey, change: SectionChange) =>
    sectionConflicts({
      section: key,
      change,
      channels: ownSettingsIds().map((channelId) => ({
        channelId,
        channelType: conflictChannel(channelId)?.channelType,
        own: ownSettings(channelId),
      })),
      labels: sources.labels(),
      favoriteChannelIds: sources.favoriteChannelIds(),
    });

  const section = (key: NotificationSectionKey): SectionNotificationView => {
    const settings = sectionSettings().get(key) ?? UNSET_SECTION_SETTINGS;
    const kinds = sectionEnabledKinds(settings);
    return {
      enabled: kinds,
      preset: presetFor(kinds),
      mute: settings.mute,
      muted: sectionMuteActive(settings.mute, new Date()),
    };
  };

  const pending = () => channelMutation.isPending || sectionMutation.isPending;

  const failed = () =>
    toast.failure(t('channelSections.notificationSettingsFailed'));

  /**
   * Run a settings write in its own span, keyed by what it changes, and
   * report a failure the way every setting does.
   */
  const save = (
    operation: string,
    target: { channelId: string } | { section: NotificationSectionKey },
    write: () => Promise<unknown>
  ) =>
    Telemetry.span(`notifications.settings.${operation}`, async (span) => {
      if ('channelId' in target) span.setAttr('channel.id', target.channelId);
      else span.setAttr('notification.section', target.section);
      const result = await catchToResult(write);
      if (result.isErr()) {
        span.error(result.error);
        failed();
      }
      return result.isOk();
    });

  /** Give the channel its own full set of kinds, as a preset or the dialog does. */
  const setChannelKinds = (
    channelId: string,
    kinds: ReadonlySet<ChannelNotificationKind>
  ) =>
    save('set_channel_kinds', { channelId }, () =>
      channelMutation.mutateAsync({
        channelId,
        change: {
          enabled: CHANNEL_NOTIFICATION_KINDS.filter((kind) => kinds.has(kind)),
        },
      })
    );

  /** Drop the channel's own kinds so it follows its sections again. */
  const followSectionSettings = (channelId: string) =>
    save('follow_sections', { channelId }, () =>
      channelMutation.mutateAsync({ channelId, change: { inherit: true } })
    );

  const setOverridesSectionMute = (channelId: string, value: boolean) =>
    save('override_section_mute', { channelId }, () =>
      channelMutation.mutateAsync({
        channelId,
        change: { overridesSectionMute: value },
      })
    );

  const setSectionKinds = (
    key: NotificationSectionKey,
    kinds: ReadonlySet<ChannelNotificationKind>
  ) =>
    save('set_section_kinds', { section: key }, () =>
      sectionMutation.mutateAsync({
        section: channelSectionOf(key),
        ...changeForKinds(kinds),
      })
    );

  const setSectionMute = (key: NotificationSectionKey, mute: SectionMute) =>
    save('set_section_mute', { section: key }, () =>
      sectionMutation.mutateAsync({ section: channelSectionOf(key), mute })
    );

  return {
    enabled,
    pending,
    channel,
    section,
    sectionConflicts: conflictsFor,
    /** A conflicting channel's name, once its record resolves. */
    conflictChannelName: (channelId: string) =>
      conflictChannel(channelId)?.name,
    setChannelKinds,
    setChannelPreset: (
      channelId: string,
      preset: Exclude<NotificationPreset, 'custom'>
    ) => setChannelKinds(channelId, new Set(PRESET_KINDS[preset])),
    followSectionSettings,
    setOverridesSectionMute,
    setSectionKinds,
    setSectionPreset: (
      key: NotificationSectionKey,
      preset: Exclude<NotificationPreset, 'custom'>
    ) => setSectionKinds(key, new Set(PRESET_KINDS[preset])),
    setSectionMute,
  };
}

export type ChannelNotificationSettingsState = ReturnType<
  typeof createChannelNotificationSettings
>;

/**
 * The same settings outside the Chat rail, reading the sections and
 * favorites the rail shows from their shared queries.
 */
export function useChannelNotificationSettings() {
  const settingsFlag = useFeatureFlag(enableChannelNotificationSettings);
  const sectionsFlag = useFeatureFlag(enableChatSidebarSections);
  // Lists outside Chat build entity menus too; read sections only when the
  // settings can use them, and personal ones only where the rail shows them.
  const readSections = () => settingsFlag().enabled;
  const readPersonal = () => readSections() && sectionsFlag().enabled;
  const teamLabels = useChannelLabelsQuery(undefined, readSections);
  const personalLabels = useChannelLabelsQuery('personal', readPersonal);
  const favorites = useFavoritesData(
    { entityType: ['channel'] },
    () => settingsFlag().enabled
  );

  const labels = createMemo<readonly ChannelNotificationLabel[]>(() => {
    if (!readSections()) return [];
    // As the rail: with sidebar sections the default scope is shared only
    // for team members; without them it holds the legacy labels.
    const shared =
      queryReadyGate(teamLabels) &&
      (teamLabels.data?.teamId || !sectionsFlag().enabled)
        ? (teamLabels.data?.labels ?? [])
        : [];
    const personal =
      readPersonal() && queryReadyGate(personalLabels)
        ? (personalLabels.data?.labels ?? [])
        : [];
    return [...shared, ...personal];
  });

  const favoriteChannelIds = createMemo(
    () =>
      new Set(
        (favorites()?.favorites ?? [])
          .filter((favorite) => favorite.entityType === 'channel')
          .map((favorite) => favorite.entityId)
      )
  );

  return createChannelNotificationSettings({ labels, favoriteChannelIds });
}
