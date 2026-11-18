import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import type { ChannelSection } from '@service-notification/generated/schemas/channelSection';
import type { SectionMute } from '@service-notification/generated/schemas/sectionMute';

/**
 * Channel and Chat section notification settings, resolved the way
 * notification ingress resolves them (`channel_delivery` in the
 * `notification` crate), so menus show what the server will deliver.
 */

/** The kinds a user can turn on or off, in menu order. */
export const CHANNEL_NOTIFICATION_KINDS = [
  'channel_message_send',
  'channel_message_reply',
  'channel_mention',
  'channel_message_reaction',
  'call_started',
  'channel_access_requested',
] as const satisfies readonly ChannelNotificationKind[];

export type NotificationPreset = 'all' | 'involving' | 'custom' | 'nothing';

/** The kinds each preset turns on; every other kind is off. */
export const PRESET_KINDS: Record<
  Exclude<NotificationPreset, 'custom'>,
  readonly ChannelNotificationKind[]
> = {
  all: CHANNEL_NOTIFICATION_KINDS,
  involving: [
    'channel_message_reply',
    'channel_mention',
    'call_started',
    'channel_access_requested',
  ],
  nothing: [],
};

/** The preset matching a set of enabled kinds, or custom when none does. */
export function presetFor(
  enabled: ReadonlySet<ChannelNotificationKind>
): NotificationPreset {
  for (const preset of ['all', 'involving', 'nothing'] as const) {
    const kinds = PRESET_KINDS[preset];
    if (
      kinds.length === enabled.size &&
      kinds.every((kind) => enabled.has(kind))
    ) {
      return preset;
    }
  }
  return 'custom';
}

/** A change that sets every kind, as choosing a preset or saving the dialog does. */
export function changeForKinds(enabled: ReadonlySet<ChannelNotificationKind>): {
  enable: ChannelNotificationKind[];
  disable: ChannelNotificationKind[];
} {
  return {
    enable: CHANNEL_NOTIFICATION_KINDS.filter((kind) => enabled.has(kind)),
    disable: CHANNEL_NOTIFICATION_KINDS.filter((kind) => !enabled.has(kind)),
  };
}

/** A sidebar section that can hold notification settings; "All channels" can't. */
export type NotificationSectionKey =
  | 'favorites'
  | 'direct_messages'
  | 'team_channels'
  | `label:${string}`;

export function sectionKeyOf(section: ChannelSection): NotificationSectionKey {
  return section.type === 'label' ? `label:${section.labelId}` : section.type;
}

export function channelSectionOf(key: NotificationSectionKey): ChannelSection {
  if (
    key === 'favorites' ||
    key === 'direct_messages' ||
    key === 'team_channels'
  ) {
    return { type: key };
  }
  return { type: 'label', labelId: key.slice('label:'.length) };
}

export type ChannelOwnSettings = {
  disabled: ReadonlySet<ChannelNotificationKind>;
  enabled: ReadonlySet<ChannelNotificationKind>;
  overridesSectionMute: boolean;
};

export type SectionSettings = {
  disabled: ReadonlySet<ChannelNotificationKind>;
  mute: SectionMute;
};

export const UNSET_CHANNEL_SETTINGS: ChannelOwnSettings = {
  disabled: new Set(),
  enabled: new Set(),
  overridesSectionMute: false,
};

export const UNSET_SECTION_SETTINGS: SectionSettings = {
  disabled: new Set(),
  mute: { state: 'unmuted' },
};

/** Whether a section mute is in effect at `now`; an ended snooze is not. */
export function sectionMuteActive(mute: SectionMute, now: Date): boolean {
  if (mute.state === 'snoozed') return new Date(mute.until) > now;
  return mute.state === 'muted';
}

/**
 * The sections holding a channel, as the sidebar shows it: its custom
 * sections, else the built-in section for its type, plus Favorites.
 */
export function sectionsHoldingChannel(args: {
  channelId: string;
  channelType: string | undefined;
  labels: readonly { id: string; channelIds: readonly string[] }[];
  favoriteChannelIds: ReadonlySet<string>;
}): NotificationSectionKey[] {
  const sections: NotificationSectionKey[] = args.labels
    .filter((label) => label.channelIds.includes(args.channelId))
    .map((label) => `label:${label.id}` as const);

  if (sections.length === 0) {
    if (args.channelType === 'direct_message') sections.push('direct_messages');
    if (args.channelType === 'team') sections.push('team_channels');
  }

  if (args.favoriteChannelIds.has(args.channelId)) sections.push('favorites');
  return sections;
}

export type EffectiveChannelNotifications = {
  /** The kinds the channel notifies for. */
  enabled: ReadonlySet<ChannelNotificationKind>;
  /** Every section holding the channel is muted and the channel doesn't override it. */
  mutedBySections: boolean;
  /** The holding sections that have settings, which decide the kinds the channel leaves alone. */
  deciding: readonly NotificationSectionKey[];
  /** The channel has a choice of its own for at least one kind. */
  hasOwnChoices: boolean;
};

/**
 * What a channel delivers under its own and its sections' settings. A section
 * with no settings allows every kind and is unmuted; the channel's own choice
 * for a kind wins over its sections.
 */
export function effectiveChannelNotifications(args: {
  channel: ChannelOwnSettings;
  sections: readonly NotificationSectionKey[];
  sectionSettings: ReadonlyMap<NotificationSectionKey, SectionSettings>;
  now: Date;
}): EffectiveChannelNotifications {
  const settingsOf = (section: NotificationSectionKey) =>
    args.sectionSettings.get(section) ?? UNSET_SECTION_SETTINGS;

  const mutedBySections =
    !args.channel.overridesSectionMute &&
    args.sections.length > 0 &&
    args.sections.every((section) =>
      sectionMuteActive(settingsOf(section).mute, args.now)
    );

  const sectionsAllow = (kind: ChannelNotificationKind) =>
    args.sections.length === 0 ||
    args.sections.some((section) => !settingsOf(section).disabled.has(kind));

  const enabled = new Set(
    CHANNEL_NOTIFICATION_KINDS.filter((kind) => {
      if (args.channel.disabled.has(kind)) return false;
      if (args.channel.enabled.has(kind)) return true;
      return sectionsAllow(kind);
    })
  );

  return {
    enabled,
    mutedBySections,
    deciding: args.sections.filter((section) =>
      args.sectionSettings.has(section)
    ),
    hasOwnChoices:
      args.channel.disabled.size > 0 || args.channel.enabled.size > 0,
  };
}

/** The kinds a section allows. */
export function sectionEnabledKinds(
  settings: SectionSettings
): ReadonlySet<ChannelNotificationKind> {
  return new Set(
    CHANNEL_NOTIFICATION_KINDS.filter((kind) => !settings.disabled.has(kind))
  );
}
