import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  canLabelChannel,
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
