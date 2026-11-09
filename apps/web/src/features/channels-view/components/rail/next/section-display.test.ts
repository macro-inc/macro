import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
  groupChannelRailSections,
} from './build-channel-rail-rows';

const READ: ChannelEntity = {
  id: 'read',
  name: 'Read',
  type: 'channel',
  ownerId: 'viewer',
  channelType: 'team',
};
const UNREAD: ChannelEntity = { ...READ, id: 'unread', name: 'Unread' };
const LABEL: ChannelLabel = {
  id: 'custom',
  name: 'Custom',
  channelIds: ['read', 'unread'],
  channelCount: 2,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const BY_ID = new Map([
  ['read', READ],
  ['unread', UNREAD],
]);
const ITEMS = {
  favorites: [],
  team_channels: [READ, UNREAD],
  channels: [],
  direct_messages: [],
  recents: [],
  threads: [],
};

describe('section display', () => {
  it('keeps only unread rows under collapsed built-in and custom headings', () => {
    const sections = groupChannelRailSections(
      buildChannelRailRows(
        'browse',
        {
          favorites: false,
          team_channels: false,
          channels: false,
          direct_messages: false,
        },
        { ...ITEMS, favorites: [] },
        buildChannelSectionRows({
          labels: [LABEL],
          channels: [],
          channelsById: BY_ID,
          isLabelOpen: () => true,
        }),
        {
          preferences: {},
          channelById: (id) => BY_ID.get(id),
          unreadChannelIds: new Set(['unread']),
          isLabelOpen: () => false,
        }
      )
    );
    expect(sections.get('team_channels')?.rows.map((row) => row.id)).toEqual([
      'channel:unread',
    ]);
    expect(sections.get('label:custom')?.rows.map((row) => row.id)).toEqual([
      'channel:unread:label:custom',
    ]);
    expect(sections.has('direct_messages')).toBe(true);
  });

  it('hides every row when unread-when-collapsed is off without affecting expanded rows', () => {
    const collapsed = groupChannelRailSections(
      buildChannelRailRows(
        'browse',
        {
          favorites: true,
          team_channels: false,
          channels: true,
          direct_messages: true,
        },
        { ...ITEMS, favorites: [] },
        [],
        {
          preferences: { team_channels: { unreadWhenCollapsed: false } },
          channelById: (id) => BY_ID.get(id),
          unreadChannelIds: new Set(['unread']),
        }
      )
    );
    expect(collapsed.get('team_channels')?.rows).toEqual([]);
    const expanded = groupChannelRailSections(
      buildChannelRailRows(
        'browse',
        {
          favorites: true,
          team_channels: true,
          channels: true,
          direct_messages: true,
        },
        { ...ITEMS, favorites: [] },
        [],
        {
          preferences: { team_channels: { unreadWhenCollapsed: false } },
          channelById: (id) => BY_ID.get(id),
          unreadChannelIds: new Set(['unread']),
        }
      )
    );
    expect(
      expanded
        .get('team_channels')
        ?.rows.filter((row) => row.kind === 'conversation').length
    ).toBe(2);
  });
});
