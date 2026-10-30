import { describe, expect, it } from 'vitest';
import { supportChannelIds } from './support-channels';

const channels = [
  { id: 'c-support-b', is_support: true, owner_id: 'macro|b@example.com' },
  { id: 'a-own-support', is_support: true, owner_id: 'macro|me@example.com' },
  { id: 'b-team', is_support: false, owner_id: 'macro|b@example.com' },
  { id: 'd-older-server', owner_id: 'macro|c@example.com' },
  { id: 'a-support-c', is_support: true, owner_id: 'macro|c@example.com' },
];

describe('supportChannelIds', () => {
  it('lists other users’ support channels, sorted, and leaves out the viewer’s own', () => {
    expect(supportChannelIds(channels, 'macro|me@example.com')).toEqual([
      'a-support-c',
      'c-support-b',
    ]);
  });

  it('keeps a new user’s own support channel among their channels', () => {
    expect(
      supportChannelIds(
        channels.filter((channel) => channel.id === 'a-own-support'),
        'macro|me@example.com'
      )
    ).toEqual([]);
  });

  it('lists nothing until the viewer is known', () => {
    expect(supportChannelIds(channels, undefined)).toEqual([]);
  });
});
