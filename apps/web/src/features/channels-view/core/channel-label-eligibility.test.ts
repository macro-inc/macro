import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  canLabelChannel,
  filterChannelLabelMembers,
} from './channel-label-eligibility';

describe('channel label eligibility', () => {
  it('requires a known team channel', () => {
    expect(canLabelChannel({ channelType: 'team' })).toBe(true);
    expect(canLabelChannel({ channelType: 'public' })).toBe(false);
    expect(canLabelChannel({ channelType: 'private' })).toBe(false);
    expect(canLabelChannel({ channelType: 'direct_message' })).toBe(false);
    expect(canLabelChannel(undefined)).toBe(false);
  });

  it('retains unloaded server memberships for unread activity while removing known non-team channels', () => {
    const members = filterChannelLabelMembers(
      ['unloaded', 'public', 'team', 'private', 'dm'],
      new Map<string, Pick<ChannelEntity, 'channelType'>>([
        ['public', { channelType: 'public' }],
        ['team', { channelType: 'team' }],
        ['private', { channelType: 'private' }],
        ['dm', { channelType: 'direct_message' }],
      ])
    );

    expect(members).toEqual(['unloaded', 'team']);
  });
});
