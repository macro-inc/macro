import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  canAssignChannel,
  canLabelChannel,
  channelSectionDropError,
  channelSectionScopeChangeError,
  filterChannelLabelMembers,
} from './channel-label-eligibility';

describe('channel label eligibility', () => {
  it('allows named conversations in personal sections but excludes DMs', () => {
    expect(canLabelChannel({ channelType: 'team' })).toBe(true);
    expect(canLabelChannel({ channelType: 'public' })).toBe(true);
    expect(canLabelChannel({ channelType: 'private' })).toBe(true);
    expect(canLabelChannel({ channelType: 'direct_message' })).toBe(false);
    expect(canLabelChannel(undefined)).toBe(false);
  });

  it('keeps shared sections restricted to team channels', () => {
    const shared = { teamId: 'team' };
    expect(canLabelChannel({ channelType: 'team' }, shared)).toBe(true);
    expect(
      canAssignChannel({ channelType: 'team', teamId: 'team' }, shared)
    ).toBe(true);
    expect(
      canAssignChannel({ channelType: 'team', teamId: 'another-team' }, shared)
    ).toBe(false);
    expect(canAssignChannel({ channelType: 'team' }, shared)).toBe(false);
    expect(canLabelChannel({ channelType: 'private' }, shared)).toBe(false);
    expect(canLabelChannel({ channelType: 'public' }, shared)).toBe(false);
    expect(canLabelChannel({ channelType: 'direct_message' }, shared)).toBe(
      false
    );
  });

  it('retains unloaded server memberships for unread activity while removing known non-team channels', () => {
    const members = filterChannelLabelMembers(
      ['unloaded', 'public', 'team', 'private', 'dm'],
      new Map<string, Pick<ChannelEntity, 'channelType'>>([
        ['public', { channelType: 'public' }],
        ['team', { channelType: 'team' }],
        ['private', { channelType: 'private' }],
        ['dm', { channelType: 'direct_message' }],
      ]),
      { teamId: 'team' }
    );

    expect(members).toEqual(['unloaded', 'team']);
  });
});

describe('section scope change eligibility', () => {
  const channels = new Map<
    string,
    Pick<ChannelEntity, 'channelType' | 'teamId' | 'isParticipant'>
  >([
    [
      'team-channel',
      { channelType: 'team' as const, teamId: 'team', isParticipant: true },
    ],
    [
      'other-team',
      { channelType: 'team' as const, teamId: 'other', isParticipant: true },
    ],
    ['private', { channelType: 'private' as const, isParticipant: true }],
    [
      'left',
      { channelType: 'team' as const, teamId: 'team', isParticipant: false },
    ],
  ]);

  it('allows empty sections and complete eligible membership', () => {
    expect(
      channelSectionScopeChangeError(
        { channelIds: [], channelCount: 0 },
        channels,
        { teamId: 'team' }
      )
    ).toBeUndefined();
    expect(
      channelSectionScopeChangeError(
        { channelIds: ['team-channel'], channelCount: 1 },
        channels,
        { teamId: 'team' }
      )
    ).toBeUndefined();
    expect(
      channelSectionScopeChangeError(
        { channelIds: ['team-channel'], channelCount: 1 },
        channels,
        {}
      )
    ).toBeUndefined();
  });

  it('rejects private channels and channels from another team without dropping members', () => {
    expect(
      channelSectionScopeChangeError(
        { channelIds: ['team-channel', 'private'], channelCount: 2 },
        channels,
        { teamId: 'team' }
      )
    ).toBe('team-only');
    expect(
      channelSectionScopeChangeError(
        { channelIds: ['other-team'], channelCount: 1 },
        channels,
        { teamId: 'team' }
      )
    ).toBe('team-only');
  });

  it('requires the complete membership and current participation for both scopes', () => {
    for (const target of [{ teamId: 'team' }, {}]) {
      expect(
        channelSectionScopeChangeError(
          { channelIds: ['team-channel'], channelCount: 2 },
          channels,
          target
        )
      ).toBe('unavailable');
      expect(
        channelSectionScopeChangeError(
          { channelIds: ['missing'], channelCount: 1 },
          channels,
          target
        )
      ).toBe('unavailable');
      expect(
        channelSectionScopeChangeError(
          { channelIds: ['left'], channelCount: 1 },
          channels,
          target
        )
      ).toBe('unavailable');
    }
  });
});

describe('section drop eligibility', () => {
  it('rejects automatic membership and channels outside shared scope', () => {
    const channel = { id: 'channel', channelType: 'private' as const };
    const label = { id: 'section', channelIds: [], teamId: 'team' };

    expect(
      channelSectionDropError({ section: 'label:section', label, channel })
    ).toBe('team-only');
    expect(
      channelSectionDropError({
        section: 'label:section',
        channel,
        label: {
          ...label,
          teamId: undefined,
          rule: { attribute: 'name', contains: 'design' },
        },
      })
    ).toBe('smart');
  });

  it('accepts new manual membership and rejects existing membership', () => {
    const channel = {
      id: 'channel',
      channelType: 'team' as const,
      teamId: 'team',
    };
    const label = { id: 'section', channelIds: [], teamId: 'team' };

    expect(
      channelSectionDropError({ section: 'label:section', label, channel })
    ).toBeUndefined();
    expect(
      channelSectionDropError({
        section: 'label:section',
        label: { ...label, channelIds: ['channel'] },
        channel,
      })
    ).toBe('already-present');
    expect(
      channelSectionDropError({
        section: 'label:section',
        label,
        channel,
        sourceLabelId: 'section',
      })
    ).toBe('already-present');
  });

  it('only removes assignments into the matching built-in channel group', () => {
    const channel = { id: 'channel', channelType: 'private' as const };
    const sourceLabelId = 'section';

    expect(
      channelSectionDropError({ section: 'channels', channel, sourceLabelId })
    ).toBeUndefined();
    expect(channelSectionDropError({ section: 'channels', channel })).toBe(
      'already-present'
    );
    expect(
      channelSectionDropError({
        section: 'team_channels',
        channel,
        sourceLabelId,
      })
    ).toBe('team-only');
    expect(
      channelSectionDropError({ section: 'favorites', channel, sourceLabelId })
    ).toBe('unsupported');
    expect(
      channelSectionDropError({
        section: 'direct_messages',
        channel,
        sourceLabelId,
      })
    ).toBe('unsupported');
  });

  it('does not accept an unloaded channel or a direct message', () => {
    expect(
      channelSectionDropError({
        section: 'label:section',
        label: { id: 'section', channelIds: [] },
      })
    ).toBe('unsupported');
    expect(
      channelSectionDropError({
        section: 'label:section',
        label: { id: 'section', channelIds: [] },
        channel: { id: 'dm', channelType: 'direct_message' },
      })
    ).toBe('unsupported');
  });
});
