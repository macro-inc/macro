import type { ChannelEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import {
  canLabelChannel,
  filterChannelLabelMembers,
} from './channel-label-eligibility';

describe('channel label eligibility', () => {
  it('accepts public, private, and team channels while rejecting direct messages and unknown IDs', () => {
    expect(canLabelChannel({ channelType: 'team' })).toBe(true);
    expect(canLabelChannel({ channelType: 'public' })).toBe(true);
    expect(canLabelChannel({ channelType: 'private' })).toBe(true);
    expect(canLabelChannel({ channelType: 'direct_message' })).toBe(false);
    expect(canLabelChannel(undefined)).toBe(false);
  });

  it('retains unloaded and non-DM server memberships for unread activity while removing known direct messages', () => {
    const members = filterChannelLabelMembers(
      ['unloaded', 'public', 'team', 'private', 'dm'],
      new Map<string, Pick<ChannelEntity, 'channelType'>>([
        ['public', { channelType: 'public' }],
        ['team', { channelType: 'team' }],
        ['private', { channelType: 'private' }],
        ['dm', { channelType: 'direct_message' }],
      ])
    );

    expect(members).toEqual(['unloaded', 'public', 'team', 'private']);
  });
});
