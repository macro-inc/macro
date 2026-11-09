import type { ChannelEntity } from '@entity';
import { expect, it } from 'vitest';
import { orderSectionSearchResults } from './channel-discovery';

it('puts unjoined channels first while preserving relevance within both groups', () => {
  const channels: ChannelEntity[] = [
    {
      id: 'joined-first',
      name: 'Match',
      type: 'channel',
      ownerId: 'viewer',
      channelType: 'team',
      isParticipant: true,
    },
    {
      id: 'unjoined-first',
      name: 'Match',
      type: 'channel',
      ownerId: 'viewer',
      channelType: 'team',
      isParticipant: false,
    },
    {
      id: 'unknown',
      name: 'Match two',
      type: 'channel',
      ownerId: 'viewer',
      channelType: 'public',
    },
    {
      id: 'unjoined-next',
      name: 'Match two',
      type: 'channel',
      ownerId: 'viewer',
      channelType: 'team',
      isParticipant: false,
    },
  ];
  expect(
    orderSectionSearchResults(channels).map((channel) => channel.id)
  ).toEqual(['unjoined-first', 'unjoined-next', 'joined-first', 'unknown']);
  expect(channels[0].id).toBe('joined-first');
});
