import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  enableChannelNotificationSettings,
  enableChatSidebarSections,
} from '@core/constant/featureFlags';
import { catchToResult } from '@core/util/result';
import { isMentionsOnlyItem } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import { useChannelLabelsQuery } from '@queries/channel-labels/channel-labels';
import { useFavoritesData } from '@queries/favorites/favorites';
import { queryReadyGate } from '@queries/gate';
import {
  useChannelNotificationSettingsMutation,
  useChannelNotificationSettingsQuery,
  useSectionNotificationSettingsMutation,
  useSectionNotificationSettingsQuery,
} from '@queries/notification/notification-settings';
import {
  useMutedEntitiesQuery,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import type { SectionMute } from '@service-notification/generated/schemas/sectionMute';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ChannelOwnSettings,
  changeForKinds,
  channelSectionOf,
  type EffectiveChannelNotifications,
  effectiveChannelNotifications,
  type NotificationPreset,
  type NotificationSectionKey,
  PRESET_KINDS,
  presetFor,
  type SectionSettings,
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
};

export type ChannelNotificationView = EffectiveChannelNotifications & {
  preset: NotificationPreset;
  /** "Following …", when the channel takes every kind from its sections. */
  following: string | undefined;
  /** The holding sections' names, for "Muted by …". */
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
  const unmuteMutation = useUnmuteItemMutation();

  const channelSettings = createMemo(() => {
    const settings = new Map<string, ChannelOwnSettings>();
    if (!queryReadyGate(channelQuery)) return settings;
    for (const entry of channelQuery.data ?? []) {
      settings.set(entry.channelId, {
        disabled: new Set(entry.disabled),
        enabled: new Set(entry.enabled),
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

  const legacyMentionsOnly = (channelId: string) =>
    queryReadyGate(mutedQuery) &&
    isMentionsOnlyItem(mutedQuery.data ?? [], {
      item_type: 'channel',
      item_id: channelId,
    });

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

  /** A legacy mentions-only channel reads as notifying for @mentions alone. */
  const ownSettings = (channelId: string): ChannelOwnSettings => {
    const own = channelSettings().get(channelId);
    if (own || !legacyMentionsOnly(channelId)) {
      return own ?? UNSET_CHANNEL_SETTINGS;
    }
    const { enable, disable } = changeForKinds(new Set(['channel_mention']));
    return {
      enabled: new Set(enable),
      disabled: new Set(disable),
      overridesSectionMute: false,
    };
  };

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
    const [only] = effective.deciding;
    const following = match(effective.deciding.length)
      .when(
        (count) => effective.hasOwnChoices || count === 0,
        () => undefined
      )
      .with(1, () =>
        t('channelSections.followingSection', { name: sectionName(only) })
      )
      .otherwise(() => t('channelSections.followingSections'));
    return {
      ...effective,
      preset: presetFor(effective.enabled),
      following,
      sectionNames: sections.map(sectionName).join(', '),
    };
  };

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

  const pending = () =>
    channelMutation.isPending ||
    sectionMutation.isPending ||
    unmuteMutation.isPending;

  const failed = () =>
    toast.failure(t('channelSections.notificationSettingsFailed'));

  /** A legacy mentions-only row would keep silencing the channel; drop it. */
  const dropLegacyMentionsOnly = async (channelId: string) => {
    if (!legacyMentionsOnly(channelId)) return;
    await unmuteMutation.mutateAsync({
      item_type: 'channel',
      item_id: channelId,
    });
  };

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

  /** Set every kind on the channel itself, as a preset or the dialog does. */
  const setChannelKinds = (
    channelId: string,
    kinds: ReadonlySet<ChannelNotificationKind>
  ) =>
    save('set_channel_kinds', { channelId }, async () => {
      await channelMutation.mutateAsync({
        channelId,
        change: changeForKinds(kinds),
      });
      await dropLegacyMentionsOnly(channelId);
    });

  const followSectionSettings = (channelId: string) =>
    save('follow_sections', { channelId }, async () => {
      await channelMutation.mutateAsync({ channelId, change: undefined });
      await dropLegacyMentionsOnly(channelId);
    });

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
  // settings can use them.
  const readSections = () => settingsFlag().enabled && sectionsFlag().enabled;
  const teamLabels = useChannelLabelsQuery(undefined, readSections);
  const personalLabels = useChannelLabelsQuery('personal', readSections);
  const favorites = useFavoritesData({ entityType: ['channel'] });

  const labels = createMemo<readonly ChannelNotificationLabel[]>(() => {
    if (!readSections()) return [];
    const shared =
      queryReadyGate(teamLabels) && teamLabels.data?.teamId
        ? teamLabels.data.labels
        : [];
    const personal = queryReadyGate(personalLabels)
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
