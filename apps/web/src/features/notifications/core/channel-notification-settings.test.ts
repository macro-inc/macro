import type { ChannelNotificationKind } from '@service-notification/generated/schemas/channelNotificationKind';
import { describe, expect, it } from 'vitest';
import {
  type ChannelOwnSettings,
  effectiveChannelNotifications,
  type NotificationSectionKey,
  PRESET_KINDS,
  presetFor,
  type SectionSettings,
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
    expect(result.deciding).toEqual(['label:a', 'label:b']);
  });

  it('treats an untouched section as allowing everything', () => {
    const result = effective(
      ['label:a', 'favorites'],
      [['label:a', allowingOnly([])]]
    );

    expect(presetFor(result.enabled)).toBe('all');
  });

  it("lets the channel's own choice win kind by kind", () => {
    const result = effective(
      ['label:a'],
      [['label:a', allowingOnly(['channel_mention'])]],
      {
        disabled: new Set(['channel_mention']),
        enabled: new Set(['channel_message_send']),
        overridesSectionMute: false,
      }
    );

    expect([...result.enabled]).toEqual(['channel_message_send']);
    expect(result.hasOwnChoices).toBe(true);
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
