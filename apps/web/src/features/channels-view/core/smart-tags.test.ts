import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import {
  channelMatchesSmartTag,
  resolveChannelLabelMemberships,
} from './smart-tags';

const channel = (
  id: string,
  name: string,
  channelType: ChannelEntity['channelType'] = 'team'
): ChannelEntity => ({
  id,
  name,
  channelType,
  type: 'channel',
  ownerId: 'alice',
});
const rule = { attribute: 'name' as const, contains: 'support' };
const label = (id: string, channelIds: string[]): ChannelLabel => ({
  id,
  name: id,
  channelIds,
  channelCount: channelIds.length,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  rule,
});

describe('smart tag matching', () => {
  it('matches literal substrings ignoring case, excluding empty patterns', () => {
    expect(channelMatchesSmartTag(channel('a', 'Acme SUPPORT'), rule)).toBe(
      true
    );
    expect(
      channelMatchesSmartTag(channel('a', 'support', 'direct_message'), rule)
    ).toBe(false);
    expect(
      channelMatchesSmartTag(channel('a', '100%_support'), {
        attribute: 'name',
        contains: '%_',
      })
    ).toBe(true);
    expect(
      channelMatchesSmartTag(channel('a', 'any'), {
        attribute: 'name',
        contains: '%',
      })
    ).toBe(false);
    expect(
      channelMatchesSmartTag(channel('a', 'any'), {
        attribute: 'name',
        contains: '',
      })
    ).toBe(false);
  });

  it('updates loaded memberships on channel rename while retaining matches beyond loaded pages', () => {
    const manual = { ...label('manual', ['renamed']), rule: null };
    const result = resolveChannelLabelMemberships(
      [label('smart', ['unloaded', 'renamed']), manual],
      [channel('renamed', 'Sales'), channel('new', 'New Support')]
    );
    expect(result[0].channelIds).toEqual(['unloaded', 'new']);
    expect(result[0].channelCount).toBe(2);
    expect(result[1]).toBe(manual);
  });

  it.each(['public', 'private', 'team'] as const)(
    'includes %s channels in smart matching and cached manual or smart memberships',
    (channelType) => {
      const matchingChannel = channel('matching', 'Support', channelType);
      expect(channelMatchesSmartTag(matchingChannel, rule)).toBe(true);
      const result = resolveChannelLabelMemberships(
        [
          { ...label('manual', ['unloaded', 'matching']), rule: null },
          label('smart', ['unloaded', 'matching']),
        ],
        [matchingChannel]
      );
      for (const resolved of result) {
        expect(resolved.channelIds).toEqual(['unloaded', 'matching']);
        expect(resolved.channelCount).toBe(2);
      }
    }
  );

  it('excludes direct messages from smart matching and cached manual or smart memberships', () => {
    const dm = channel('dm', 'Support', 'direct_message');
    expect(channelMatchesSmartTag(dm, rule)).toBe(false);
    const result = resolveChannelLabelMemberships(
      [
        { ...label('manual', ['unloaded', 'dm']), rule: null },
        label('smart', ['unloaded', 'dm']),
      ],
      [dm]
    );
    for (const resolved of result) {
      expect(resolved.channelIds).toEqual(['unloaded']);
      expect(resolved.channelCount).toBe(1);
    }
  });

  it('preserves the manual count of assignments outside the loaded viewer-relative IDs', () => {
    const result = resolveChannelLabelMemberships(
      [{ ...label('manual', ['dm', 'team']), rule: null, channelCount: 8 }],
      [channel('dm', 'DM', 'direct_message'), channel('team', 'Support')]
    );
    expect(result[0].channelIds).toEqual(['team']);
    expect(result[0].channelCount).toBe(7);
  });

  it('adds new shared smart-label matches regardless of channel type or team identity, except DMs', () => {
    const result = resolveChannelLabelMemberships(
      [
        {
          ...label('shared', ['unloaded', 'renamed', 'member']),
          teamId: 'team',
        },
      ],
      [
        channel('renamed', 'Sales'),
        channel('member', 'Support'),
        channel('another-team', 'Support'),
        channel('public', 'Support', 'public'),
        channel('private', 'Support', 'private'),
        channel('dm', 'Support', 'direct_message'),
      ]
    );
    expect(result[0].channelIds).toEqual([
      'unloaded',
      'member',
      'another-team',
      'public',
      'private',
    ]);
    expect(result[0].channelCount).toBe(5);
  });
});
