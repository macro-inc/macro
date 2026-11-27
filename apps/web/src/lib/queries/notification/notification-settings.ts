import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '@service-notification/client';
import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import type { ChannelNotificationSettingsResponse } from '@service-notification/generated/schemas/channelNotificationSettingsResponse';
import type { ChannelSection } from '@service-notification/generated/schemas/channelSection';
import type { SectionNotificationSettingsResponse } from '@service-notification/generated/schemas/sectionNotificationSettingsResponse';
import type { UpdateChannelNotificationSettingsRequest } from '@service-notification/generated/schemas/updateChannelNotificationSettingsRequest';
import type { UpdateSectionNotificationSettingsRequest } from '@service-notification/generated/schemas/updateSectionNotificationSettingsRequest';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { notificationKeys } from './keys';

// A paused mutation lives only in memory and replays on reconnect, so an
// offline change must fail and roll back instead of waiting (as mute does).
const SETTINGS_NETWORK_MODE = 'always';
const CHANNEL_SETTINGS_MUTATION_KEY = [
  'notification',
  'channel-settings',
] as const;
const SECTION_SETTINGS_MUTATION_KEY = [
  'notification',
  'section-settings',
] as const;

async function fetchChannelSettings() {
  const response = await throwOnErr(() =>
    notificationServiceClient.listChannelNotificationSettings()
  );
  return response.channels;
}

async function fetchSectionSettings() {
  const response = await throwOnErr(() =>
    notificationServiceClient.listSectionNotificationSettings()
  );
  return response.sections;
}

function channelSettingsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: notificationKeys.channelSettings.queryKey,
    queryFn: fetchChannelSettings,
    enabled,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: 'always',
    reconcile: 'channelId',
  });
}

function sectionSettingsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: notificationKeys.sectionSettings.queryKey,
    queryFn: fetchSectionSettings,
    enabled,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: 'always',
  });
}

/** The viewer's channels that have notification settings of their own. */
export function useChannelNotificationSettingsQuery(
  enabled: Accessor<boolean>
) {
  return useQuery(() => channelSettingsQueryOptions(enabled()));
}

/** The viewer's Chat sections that have notification settings. */
export function useSectionNotificationSettingsQuery(
  enabled: Accessor<boolean>
) {
  return useQuery(() => sectionSettingsQueryOptions(enabled()));
}

function sameSection(left: ChannelSection, right: ChannelSection): boolean {
  if (left.type === 'label' && right.type === 'label') {
    return left.labelId === right.labelId;
  }
  return left.type === right.type;
}

function withoutKinds(
  kinds: readonly ChannelNotificationKind[],
  removed: readonly (readonly ChannelNotificationKind[] | undefined)[]
): ChannelNotificationKind[] {
  const drop = new Set(removed.flatMap((list) => list ?? []));
  return kinds.filter((kind) => !drop.has(kind));
}

function union(
  ...lists: readonly (readonly ChannelNotificationKind[] | undefined)[]
): ChannelNotificationKind[] {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** Apply a change the way the server does, for the optimistic cache. */
function applyChannelChange(
  channelId: string,
  previous: ChannelNotificationSettingsResponse | undefined,
  change: UpdateChannelNotificationSettingsRequest
): ChannelNotificationSettingsResponse {
  const enabled = change.inherit
    ? null
    : (change.enabled ?? previous?.enabled ?? null);
  return {
    channelId,
    enabled,
    overridesSectionMute:
      change.overridesSectionMute ?? previous?.overridesSectionMute ?? false,
  };
}

function isEmptyChannelSettings(settings: ChannelNotificationSettingsResponse) {
  return !settings.enabled && !settings.overridesSectionMute;
}

/**
 * A reset or a change to the kinds also drops the channel's legacy
 * mentions-only preference on the server, which these settings replace.
 */
function changesKinds(
  change: UpdateChannelNotificationSettingsRequest | undefined
) {
  return !change || change.inherit === true || !!change.enabled;
}

function dropLegacyMentionsOnly(channelId: string) {
  queryClient.setQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey,
    (previous) =>
      previous?.filter(
        (item) =>
          !(
            item.item_type === 'channel' &&
            item.item_id === channelId &&
            item.mentions_only
          )
      )
  );
}

function writeChannelSettings(
  channelId: string,
  settings: ChannelNotificationSettingsResponse | undefined
) {
  queryClient.setQueryData<ChannelNotificationSettingsResponse[]>(
    notificationKeys.channelSettings.queryKey,
    (previous) => {
      if (previous === undefined) return previous;
      const others = previous.filter((entry) => entry.channelId !== channelId);
      return settings && !isEmptyChannelSettings(settings)
        ? [...others, settings]
        : others;
    }
  );
}

function cachedChannelSettings(channelId: string) {
  return queryClient
    .getQueryData<ChannelNotificationSettingsResponse[]>(
      notificationKeys.channelSettings.queryKey
    )
    ?.find((entry) => entry.channelId === channelId);
}

type ChannelSettingsVariables = {
  channelId: string;
  /** Undefined resets the channel so it follows its sections. */
  change: UpdateChannelNotificationSettingsRequest | undefined;
};

async function saveChannelSettings({
  channelId,
  change,
}: ChannelSettingsVariables) {
  if (!change) {
    await throwOnErr(() =>
      notificationServiceClient.resetChannelNotificationSettings(channelId)
    );
    return undefined;
  }
  return throwOnErr(() =>
    notificationServiceClient.updateChannelNotificationSettings(
      channelId,
      change
    )
  );
}

function invalidateWhenIdle(
  mutationKey: readonly string[],
  queryKey: readonly unknown[]
) {
  if (queryClient.isMutating({ mutationKey }) > 1) return;
  fireAndForget(
    queryClient.invalidateQueries({ queryKey }),
    'notification-settings'
  );
}

/** Change or reset one channel's settings, optimistically. */
export function useChannelNotificationSettingsMutation() {
  return useMutation(() => ({
    mutationKey: CHANNEL_SETTINGS_MUTATION_KEY,
    networkMode: SETTINGS_NETWORK_MODE,
    mutationFn: saveChannelSettings,
    onMutate: async ({ channelId, change }: ChannelSettingsVariables) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.channelSettings.queryKey,
      });
      const previous = cachedChannelSettings(channelId);
      writeChannelSettings(
        channelId,
        change ? applyChannelChange(channelId, previous, change) : undefined
      );
      if (changesKinds(change)) dropLegacyMentionsOnly(channelId);
      return { previous };
    },
    onError: (_error, { channelId }, context) => {
      writeChannelSettings(channelId, context?.previous);
    },
    onSuccess: (settings, { channelId }) => {
      writeChannelSettings(channelId, settings);
    },
    onSettled: (_settings, _error, { change }) => {
      invalidateWhenIdle(
        CHANNEL_SETTINGS_MUTATION_KEY,
        notificationKeys.channelSettings.queryKey
      );
      if (changesKinds(change)) {
        invalidateWhenIdle(
          CHANNEL_SETTINGS_MUTATION_KEY,
          notificationKeys.unsubscribes.queryKey
        );
      }
    },
  }));
}

function applySectionChange(
  previous: SectionNotificationSettingsResponse | undefined,
  change: UpdateSectionNotificationSettingsRequest
): SectionNotificationSettingsResponse {
  return {
    section: change.section,
    disabled: withoutKinds(union(previous?.disabled, change.disable), [
      change.enable,
    ]),
    mute: change.mute ?? previous?.mute ?? { state: 'unmuted' },
  };
}

function writeSectionSettings(
  section: ChannelSection,
  settings: SectionNotificationSettingsResponse | undefined
) {
  queryClient.setQueryData<SectionNotificationSettingsResponse[]>(
    notificationKeys.sectionSettings.queryKey,
    (previous) => {
      if (previous === undefined) return previous;
      const others = previous.filter(
        (entry) => !sameSection(entry.section, section)
      );
      const empty =
        !settings ||
        (settings.disabled.length === 0 && settings.mute.state === 'unmuted');
      return empty ? others : [...others, settings];
    }
  );
}

async function saveSectionSettings(
  change: UpdateSectionNotificationSettingsRequest
) {
  return throwOnErr(() =>
    notificationServiceClient.updateSectionNotificationSettings(change)
  );
}

/** Change one section's settings, optimistically. */
export function useSectionNotificationSettingsMutation() {
  return useMutation(() => ({
    mutationKey: SECTION_SETTINGS_MUTATION_KEY,
    networkMode: SETTINGS_NETWORK_MODE,
    mutationFn: saveSectionSettings,
    onMutate: async (change: UpdateSectionNotificationSettingsRequest) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.sectionSettings.queryKey,
      });
      const previous = queryClient
        .getQueryData<SectionNotificationSettingsResponse[]>(
          notificationKeys.sectionSettings.queryKey
        )
        ?.find((entry) => sameSection(entry.section, change.section));
      writeSectionSettings(
        change.section,
        applySectionChange(previous, change)
      );
      return { previous };
    },
    onError: (_error, change, context) => {
      writeSectionSettings(change.section, context?.previous);
    },
    onSuccess: (settings) => {
      writeSectionSettings(settings.section, settings);
    },
    onSettled: () =>
      invalidateWhenIdle(
        SECTION_SETTINGS_MUTATION_KEY,
        notificationKeys.sectionSettings.queryKey
      ),
  }));
}
