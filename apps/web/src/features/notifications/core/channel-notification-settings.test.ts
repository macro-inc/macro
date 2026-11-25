import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { describe, expect, it } from 'vitest';
import {
  type ChannelOwnSettings,
  effectiveChannelNotifications,
  type NotificationSectionKey,
  PRESET_KINDS,
  presetFor,
  type SectionSettings,
  sectionConflicts,
  sectionsHoldingChannel,
  UNSET_CHANNEL_SETTINGS,
} from './channel-notification-settings';

const NOW = new Date('2026-11-18T12:00:00Z');

function allowingOnly(kinds: ChannelNotificationKind[]): SectionSettings {
  return {
    disabled: new Set(PRESET_KINDS.all.filter((kind) => !kinds.includes(kind))),
    mute: { state: 'unmuted' },
  };
}

function effective(
  sections: NotificationSectionKey[],
  settings: [NotificationSectionKey, SectionSettings][],
  channel: ChannelOwnSettings = UNSET_CHANNEL_SETTINGS
) {
  return effectiveChannelNotifications({
    channel,
    sections,
    sectionSettings: new Map(settings),
    now: NOW,
  });
}

describe('presetFor', () => {
  it('names the preset the kinds match, or custom', () => {
    expect(presetFor(new Set(PRESET_KINDS.all))).toBe('all');
    expect(presetFor(new Set(PRESET_KINDS.involving))).toBe('involving');
    expect(presetFor(new Set())).toBe('nothing');
    expect(presetFor(new Set(['channel_mention']))).toBe('custom');
  });
});

describe('effectiveChannelNotifications', () => {
  it('allows a kind when any section holding the channel allows it', () => {
    const result = effective(
      ['label:a', 'label:b'],
      [
        ['label:a', allowingOnly(['channel_mention'])],
        ['label:b', allowingOnly(['channel_message_reply'])],
      ]
    );

    expect([...result.enabled].sort()).toEqual([
      'channel_mention',
      'channel_message_reply',
    ]);
    expect(result.inherited).toEqual(result.enabled);
  });

  it('treats an untouched section as allowing everything', () => {
    const result = effective(
      ['label:a', 'favorites'],
      [['label:a', allowingOnly([])]]
    );

    expect(presetFor(result.enabled)).toBe('all');
  });

  it('uses a channel’s own settings for every kind, ignoring its sections', () => {
    const result = effective(
      ['label:a'],
      [['label:a', allowingOnly(['channel_mention'])]],
      {
        enabled: new Set(['channel_message_send']),
        overridesSectionMute: false,
      }
    );

    expect([...result.enabled]).toEqual(['channel_message_send']);
    expect([...result.inherited]).toEqual(['channel_mention']);
    expect(result.hasOwnSettings).toBe(true);
  });

  it('mutes only when every holding section is muted, unless overridden', () => {
    const muted: SectionSettings = {
      disabled: new Set(),
      mute: { state: 'muted' },
    };
    const ended: SectionSettings = {
      disabled: new Set(),
      mute: { state: 'snoozed', until: '2026-11-18T11:00:00Z' },
    };

    expect(
      effective(['label:a', 'label:b'], [['label:a', muted]]).mutedBySections
    ).toBe(false);
    expect(
      effective(
        ['label:a', 'label:b'],
        [
          ['label:a', muted],
          ['label:b', muted],
        ]
      ).mutedBySections
    ).toBe(true);
    expect(effective(['label:a'], [['label:a', ended]]).mutedBySections).toBe(
      false
    );
    expect(
      effective(['label:a'], [['label:a', muted]], {
        ...UNSET_CHANNEL_SETTINGS,
        overridesSectionMute: true,
      }).mutedBySections
    ).toBe(false);
  });
});

describe('sectionsHoldingChannel', () => {
  it('uses the built-in section only when no custom section holds the channel', () => {
    const labels = [{ id: 'a', channelIds: ['in-label'] }];
    const favorites = new Set(['in-label', 'dm']);

    expect(
      sectionsHoldingChannel({
        channelId: 'in-label',
        channelType: 'team',
        labels,
        favoriteChannelIds: favorites,
      })
    ).toEqual(['label:a', 'favorites']);
    expect(
      sectionsHoldingChannel({
        channelId: 'loose',
        channelType: 'team',
        labels,
        favoriteChannelIds: favorites,
      })
    ).toEqual(['team_channels']);
    expect(
      sectionsHoldingChannel({
        channelId: 'dm',
        channelType: 'direct_message',
        labels,
        favoriteChannelIds: favorites,
      })
    ).toEqual(['direct_messages', 'favorites']);
    expect(
      sectionsHoldingChannel({
        channelId: 'public',
        channelType: 'public',
        labels,
        favoriteChannelIds: favorites,
      })
    ).toEqual([]);
  });
});

describe('sectionConflicts', () => {
  const labels = [{ id: 'a', channelIds: ['own', 'same', 'override'] }];
  const channels = [
    {
      channelId: 'own',
      channelType: 'public',
      own: { enabled: new Set(PRESET_KINDS.all), overridesSectionMute: false },
    },
    {
      channelId: 'same',
      channelType: 'public',
      own: {
        enabled: new Set<ChannelNotificationKind>(),
        overridesSectionMute: false,
      },
    },
    {
      channelId: 'override',
      channelType: 'public',
      own: { enabled: undefined, overridesSectionMute: true },
    },
    {
      channelId: 'elsewhere',
      channelType: 'team',
      own: { enabled: new Set(PRESET_KINDS.all), overridesSectionMute: true },
    },
  ];
  const conflicts = (
    change: Parameters<typeof sectionConflicts>[0]['change']
  ) =>
    sectionConflicts({
      section: 'label:a',
      change,
      channels,
      labels,
      favoriteChannelIds: new Set(),
    });

  it('lists the section’s channels with their own different kinds', () => {
    expect(conflicts({ kind: 'kinds', kinds: new Set() })).toEqual(['own']);
  });

  it('lists the section’s channels that keep notifying in muted sections', () => {
    expect(conflicts({ kind: 'mute' })).toEqual(['override']);
  });
});
