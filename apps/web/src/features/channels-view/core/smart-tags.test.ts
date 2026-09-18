import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import {
  channelMatchesSmartTag,
  resolveSmartTagMemberships,
} from './smart-tags';

const channel = (id: string, name: string, channelType = 'public') =>
  ({
    id,
    name,
    channelType,
    type: 'channel',
  }) as ChannelEntity;
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
  it('matches literal substrings ignoring case, excluding DMs and empty patterns', () => {
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
    const result = resolveSmartTagMemberships(
      [label('smart', ['unloaded', 'renamed']), manual],
      [channel('renamed', 'Sales'), channel('new', 'New Support')]
    );
    expect(result[0].channelIds).toEqual(['unloaded', 'new']);
    expect(result[0].channelCount).toBe(2);
    expect(result[1]).toBe(manual);
  });
});
