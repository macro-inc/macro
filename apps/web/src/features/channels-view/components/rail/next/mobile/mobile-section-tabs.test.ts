import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { expect, it } from 'vitest';
import {
  channelsForMobileSection,
  mobileSectionTabKeys,
  resolveMobileSectionTab,
} from './mobile-section-tabs';

const LABEL: ChannelLabel = {
  id: 'custom',
  name: 'Custom',
  channelIds: ['pinned', 'unjoined'],
  channelCount: 2,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const CHANNELS: ChannelEntity[] = [
  {
    id: 'pinned',
    name: 'Pinned',
    type: 'channel',
    channelType: 'team',
    ownerId: 'viewer',
    isParticipant: true,
  },
  {
    id: 'dm',
    name: 'Direct',
    type: 'channel',
    channelType: 'direct_message',
    ownerId: 'viewer',
    isParticipant: true,
  },
  {
    id: 'unjoined',
    name: 'Unjoined',
    type: 'channel',
    channelType: 'team',
    ownerId: 'viewer',
    isParticipant: false,
  },
];

it('keeps All and DMs first and preserves custom section order without stale keys', () => {
  expect(
    mobileSectionTabKeys(
      [LABEL, { ...LABEL, id: 'second' }],
      ['label:second', 'label:removed', 'team_channels']
    )
  ).toEqual(['all', 'direct_messages', 'label:second', 'label:custom']);
  expect(
    resolveMobileSectionTab('label:removed', ['all', 'direct_messages'])
  ).toBe('all');
});

it('excludes pins only from All and retains unjoined section membership for Join', () => {
  expect(
    channelsForMobileSection({
      tab: 'all',
      channels: CHANNELS,
      pinnedIds: ['pinned'],
      labels: [LABEL],
    }).map((channel) => channel.id)
  ).toEqual(['dm']);
  expect(
    channelsForMobileSection({
      tab: 'direct_messages',
      channels: CHANNELS,
      pinnedIds: ['dm'],
      labels: [LABEL],
    }).map((channel) => channel.id)
  ).toEqual(['dm']);
  expect(
    channelsForMobileSection({
      tab: 'label:custom',
      channels: CHANNELS,
      pinnedIds: ['pinned'],
      labels: [LABEL],
    }).map((channel) => channel.id)
  ).toEqual(['pinned', 'unjoined']);
});
