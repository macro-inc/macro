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

/** Whether two sets hold the same kinds. */
export function sameKinds(
  left: ReadonlySet<ChannelNotificationKind>,
  right: ReadonlySet<ChannelNotificationKind>
): boolean {
  return left.size === right.size && [...left].every((kind) => right.has(kind));
}

/** A section change that sets every kind, as choosing a preset or saving the dialog does. */
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

/**
 * A channel either follows its sections for every kind or has its own
 * setting for all of them, never a mix.
 */
export type ChannelOwnSettings = {
  /** The kinds the channel's own settings turn on; undefined follows its sections. */
  enabled: ReadonlySet<ChannelNotificationKind> | undefined;
  overridesSectionMute: boolean;
};

export type SectionSettings = {
  disabled: ReadonlySet<ChannelNotificationKind>;
  mute: SectionMute;
};

export const UNSET_CHANNEL_SETTINGS: ChannelOwnSettings = {
  enabled: undefined,
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
  /** What the channel's sections give it: every kind any of them allows. */
  inherited: ReadonlySet<ChannelNotificationKind>;
  /** Every section holding the channel is muted and the channel doesn't override it. */
  mutedBySections: boolean;
  /** The channel has its own settings instead of its sections'. */
  hasOwnSettings: boolean;
};

/**
 * What a channel delivers under its own and its sections' settings. A section
 * with no settings allows every kind and is unmuted; a channel with its own
 * settings uses them for every kind.
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

  const inherited = new Set(
    CHANNEL_NOTIFICATION_KINDS.filter(
      (kind) =>
        args.sections.length === 0 ||
        args.sections.some((section) => !settingsOf(section).disabled.has(kind))
    )
  );

  return {
    enabled: args.channel.enabled ?? inherited,
    inherited,
    mutedBySections,
    hasOwnSettings: args.channel.enabled !== undefined,
  };
}

/** A section change the channels in it might not follow. */
export type SectionChange =
  | { kind: 'kinds'; kinds: ReadonlySet<ChannelNotificationKind> }
  | { kind: 'mute' };

/**
 * The section's channels that a change to it would not reach: those with
 * their own different kinds, or, for a mute, those set to keep notifying in
 * muted sections.
 */
export function sectionConflicts(args: {
  section: NotificationSectionKey;
  change: SectionChange;
  channels: readonly {
    channelId: string;
    channelType: string | undefined;
    own: ChannelOwnSettings;
  }[];
  labels: readonly { id: string; channelIds: readonly string[] }[];
  favoriteChannelIds: ReadonlySet<string>;
}): string[] {
  const { change } = args;
  return args.channels
    .filter(({ own }) =>
      change.kind === 'mute'
        ? own.overridesSectionMute
        : own.enabled !== undefined && !sameKinds(own.enabled, change.kinds)
    )
    .filter((channel) =>
      sectionsHoldingChannel({
        channelId: channel.channelId,
        channelType: channel.channelType,
        labels: args.labels,
        favoriteChannelIds: args.favoriteChannelIds,
      }).includes(args.section)
    )
    .map((channel) => channel.channelId);
}

/** The kinds a section allows. */
export function sectionEnabledKinds(
  settings: SectionSettings
): ReadonlySet<ChannelNotificationKind> {
  return new Set(
    CHANNEL_NOTIFICATION_KINDS.filter((kind) => !settings.disabled.has(kind))
  );
}
