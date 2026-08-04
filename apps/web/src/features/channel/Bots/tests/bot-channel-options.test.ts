import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { describe, expect, it } from 'vitest';
import {
  botAssignableChannelOptions,
  mergeChannelOptions,
  sameChannelSelection,
} from '../botChannelOptions';

const channel = (
  id: string,
  name: string | null,
  channelType: ChannelType
) => ({ id, name, channel_type: channelType });

describe('bot channel options', () => {
  it('offers private and team channels only, sorted by name', () => {
    expect(
      botAssignableChannelOptions([
        channel('c-public', 'Announcements', ChannelType.public),
        channel('c-dm', 'Direct message', ChannelType.direct_message),
        channel('c-team', '  Team ops  ', ChannelType.team),
        channel('c-private', 'Alpha', ChannelType.private),
        channel('c-unnamed', '  ', ChannelType.private),
      ])
    ).toEqual([
      { id: 'c-private', name: 'Alpha' },
      { id: 'c-team', name: 'Team ops' },
      { id: 'c-unnamed', name: 'Unnamed channel' },
    ]);
  });

  it('keeps assigned channels missing from the assignable list', () => {
    expect(
      mergeChannelOptions(
        [
          { id: 'c-hidden', name: 'Hidden channel' },
          { id: 'c-shared', name: 'Stale name' },
        ],
        [{ id: 'c-shared', name: 'Fresh name' }]
      )
    ).toEqual([
      { id: 'c-shared', name: 'Fresh name' },
      { id: 'c-hidden', name: 'Hidden channel' },
    ]);
  });

  it('compares channel selections ignoring order', () => {
    expect(sameChannelSelection([], [])).toBe(true);
    expect(sameChannelSelection(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameChannelSelection(['a'], ['a', 'b'])).toBe(false);
    expect(sameChannelSelection(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});
