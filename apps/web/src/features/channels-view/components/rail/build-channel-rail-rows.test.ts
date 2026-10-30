import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
  getChannelRailPaginationScope,
} from './build-channel-rail-rows';

function channel(
  id: string,
  name = id,
  channelType: ChannelEntity['channelType'] = 'team'
): ChannelEntity {
  return {
    id,
    name,
    type: 'channel',
    ownerId: 'alice',
    channelType,
  };
}

function label(
  id: string,
  name: string,
  channelIds: string[],
  sortOrder = 0
): ChannelLabel {
  return {
    id,
    teamId: 'team',
    name,
    sortOrder,
    channelIds,
    channelCount: channelIds.length,
    createdAt: '2026-09-18T00:00:00Z',
    updatedAt: '2026-09-18T00:00:00Z',
  };
}

const zeta = channel('zeta', 'zeta-support');
const acme = channel('acme', 'acme-support');
const globex = channel('globex', 'Globex-support');
const deals = channel('deals', 'deal-desk');
const hidden = channel('hidden', 'not-mine');

const byId = new Map([zeta, acme, globex, deals].map((c) => [c.id, c]));

describe('buildChannelSectionRows', () => {
  it('lists labels in team order with their channels A→Z, then the plain list in source order', () => {
    const rows = buildChannelSectionRows({
      labels: [
        label('l1', 'Enterprise', ['zeta', 'globex', 'acme'], 0),
        label('l2', 'Onboarding', ['deals'], 1),
      ],
      // Source order is by activity; labelled channels must not repeat below.
      channels: [deals, zeta, acme],
      channelsById: byId,
      isLabelOpen: () => true,
    });

    expect(
      rows.map((row) =>
        row.kind === 'label'
          ? `label:${row.label.name}`
          : `${row.labelId ?? '-'}:${row.channel.id}`
      )
    ).toEqual([
      'label:Enterprise',
      'l1:acme',
      'l1:globex',
      'l1:zeta',
      'label:Onboarding',
      'l2:deals',
    ]);
  });

  it('keeps unlabelled channels below the labels in source order', () => {
    const rows = buildChannelSectionRows({
      labels: [label('l1', 'Enterprise', ['acme'])],
      channels: [deals, zeta, acme],
      channelsById: byId,
      isLabelOpen: () => true,
    });

    expect(
      rows.map((row) => (row.kind === 'label' ? 'L' : row.channel.id))
    ).toEqual(['L', 'acme', 'deals', 'zeta']);
  });

  it('hides a collapsed label’s channels but keeps its heading', () => {
    const rows = buildChannelSectionRows({
      labels: [label('l1', 'Enterprise', ['acme', 'zeta'])],
      channels: [deals],
      channelsById: byId,
      isLabelOpen: () => false,
    });

    expect(rows).toEqual([
      { kind: 'label', label: expect.objectContaining({ id: 'l1' }) },
      { kind: 'conversation', channel: deals },
    ]);
  });

  it('keeps empty labels and labels with no visible channels as drop targets', () => {
    const rows = buildChannelSectionRows({
      labels: [
        label('empty', 'Empty', []),
        label('l1', 'Theirs', ['hidden']),
        label('l2', 'Mine', ['acme']),
      ],
      channels: [acme],
      channelsById: byId,
      isLabelOpen: () => true,
    });

    expect(
      rows.map((row) => (row.kind === 'label' ? row.label.id : 'c'))
    ).toEqual(['empty', 'l1', 'l2', 'c']);
    expect(
      rows.some((row) => row.kind === 'conversation' && row.channel === hidden)
    ).toBe(false);
  });

  it.each([true, false])(
    'keeps non-team channels in the plain list when labels are open=%s, ignoring cached memberships',
    (isOpen) => {
      const publicChannel = channel('public', 'Public', 'public');
      const privateChannel = channel('private', 'Private', 'private');
      const channels = [publicChannel, privateChannel, acme];
      const rows = buildChannelSectionRows({
        labels: [
          label(
            'manual',
            'Manual',
            channels.map((channel) => channel.id)
          ),
          {
            ...label(
              'smart',
              'Smart',
              channels.map((channel) => channel.id)
            ),
            rule: { attribute: 'name', contains: 'support' },
          },
        ],
        channels,
        channelsById: new Map(channels.map((channel) => [channel.id, channel])),
        isLabelOpen: () => isOpen,
      });

      expect(
        rows.filter((row) => row.kind === 'conversation' && !row.labelId)
      ).toEqual([
        { kind: 'conversation', channel: publicChannel },
        { kind: 'conversation', channel: privateChannel },
      ]);
      expect(
        rows.filter((row) => row.kind === 'conversation' && row.labelId)
      ).toEqual(
        isOpen
          ? [
              { kind: 'conversation', channel: acme, labelId: 'manual' },
              { kind: 'conversation', channel: acme, labelId: 'smart' },
            ]
          : []
      );
    }
  );
});

describe('buildChannelRailRows', () => {
  const expanded = {
    favorites: true,
    team_channels: true,
    channels: true,
    direct_messages: true,
  };

  it('pages from the last ungrouped row when the source tail belongs to a section', () => {
    const sections = buildChannelSectionRows({
      labels: [label('custom', 'Custom', ['zeta'])],
      channels: [acme, zeta],
      channelsById: byId,
      isLabelOpen: () => true,
    });
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [acme, zeta],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      sections
    );
    const plain = rows.find(
      (row) => row.kind === 'conversation' && row.channel.id === 'acme'
    )!;
    const grouped = rows.find(
      (row) => row.kind === 'conversation' && row.labelId === 'custom'
    )!;
    expect(getChannelRailPaginationScope(plain, rows, expanded)).toBe(
      'team_channels'
    );
    expect(
      getChannelRailPaginationScope(grouped, rows, expanded)
    ).toBeUndefined();
  });

  it('pages an expanded section with no ungrouped rows but leaves collapsed sections alone', () => {
    const sections = buildChannelSectionRows({
      labels: [label('custom', 'Custom', ['zeta'])],
      channels: [zeta],
      channelsById: byId,
      isLabelOpen: () => true,
    });
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [zeta],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      sections
    );
    const heading = rows.find(
      (row) => row.kind === 'section' && row.group === 'team_channels'
    )!;
    expect(getChannelRailPaginationScope(heading, rows, expanded)).toBe(
      'team_channels'
    );
    expect(
      getChannelRailPaginationScope(heading, rows, {
        ...expanded,
        team_channels: false,
      })
    ).toBeUndefined();
  });

  it('lists channels once in their section and source order', () => {
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [acme, zeta],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      buildChannelSectionRows({
        labels: [],
        channels: [acme, zeta],
        channelsById: byId,
        isLabelOpen: () => true,
      })
    );

    expect(rows.map((row) => row.id)).toEqual([
      'section:favorites',
      'section:team_channels',
      'channel:acme',
      'channel:zeta',
      'status:team_channels',
      'section:direct_messages',
    ]);
  });

  it('places custom sections after primary channels and before sticky DMs', () => {
    const privateChannel = channel('private', 'private', 'private');
    const dm = channel('dm', 'Bob', 'direct_message');
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [deals],
        channels: [privateChannel],
        direct_messages: [dm],
        recents: [],
        threads: [],
      },
      buildChannelSectionRows({
        labels: [label('l1', 'Enterprise', ['acme'])],
        channels: [deals],
        channelsById: byId,
        isLabelOpen: () => true,
      })
    );

    expect(rows.map((row) => row.id)).toEqual([
      'section:favorites',
      'section:team_channels',
      'channel:deals',
      'status:team_channels',
      'section:channels',
      'channel:private',
      'status:channels',
      'label:l1',
      'channel:acme:label:l1',
      'section:direct_messages',
      'channel:dm',
    ]);
    expect(rows[5]).toMatchObject({
      group: 'channels',
      scope: 'channels',
      localIndex: 5,
    });
  });

  it('collapses each section on its own', () => {
    const privateChannel = channel('private', 'private', 'private');
    const rows = buildChannelRailRows(
      'browse',
      { ...expanded, team_channels: false },
      {
        favorites: [],
        team_channels: [deals],
        channels: [privateChannel],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      buildChannelSectionRows({
        labels: [],
        channels: [deals],
        channelsById: byId,
        isLabelOpen: () => true,
      })
    );

    expect(rows.map((row) => row.id)).toEqual([
      'section:favorites',
      'section:team_channels',
      'section:channels',
      'channel:private',
      'status:channels',
      'section:direct_messages',
    ]);
  });

  it('uses shared-scroll indexes for custom sections and their channels', () => {
    const sectionRows = buildChannelSectionRows({
      labels: [label('l1', 'Enterprise', ['acme'])],
      channels: [deals],
      channelsById: byId,
      isLabelOpen: () => true,
    });
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [deals],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      sectionRows
    );

    expect(
      rows.filter((row) => row.kind === 'conversation' || row.kind === 'label')
    ).toEqual([
      expect.objectContaining({
        kind: 'conversation',
        id: 'channel:deals',
        localIndex: 2,
      }),
      expect.objectContaining({ kind: 'label', id: 'label:l1', localIndex: 4 }),
      expect.objectContaining({
        kind: 'conversation',
        id: 'channel:acme:label:l1',
        localIndex: 5,
        labelId: 'l1',
        scope: 'team_channels',
      }),
    ]);
  });

  it('leaves the recent tab as a flat list', () => {
    const rows = buildChannelRailRows(
      'recents',
      expanded,
      {
        favorites: [],
        team_channels: [acme],
        channels: [],
        direct_messages: [],
        recents: [zeta, acme],
        threads: [],
      },
      []
    );
    expect(rows.map((row) => row.id)).toEqual(['channel:zeta', 'channel:acme']);
  });

  it('puts All threads above one mixed list of channels and DMs', () => {
    const dm = channel('dm', 'Bob', 'direct_message');
    const rows = buildChannelRailRows(
      'threads',
      expanded,
      {
        favorites: [],
        team_channels: [acme],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [dm, acme],
      },
      []
    );
    expect(rows.map((row) => row.id)).toEqual([
      'all-threads',
      'channel:dm',
      'channel:acme',
    ]);
    expect(rows[1]).toMatchObject({ scope: 'threads', localIndex: 0 });
  });
});

it('renders a channel in every matching smart tag with unique navigation IDs, excluding it from ungrouped even when collapsed', () => {
  const labels = [
    {
      ...label('smart-1', 'Support', ['acme', 'zeta']),
      rule: { attribute: 'name' as const, contains: 'support' },
    },
    {
      ...label('smart-2', 'Acme', ['acme']),
      rule: { attribute: 'name' as const, contains: 'acme' },
    },
    label('manual', 'Manual', ['acme']),
  ];
  const sections = buildChannelSectionRows({
    labels,
    channels: [acme, zeta, deals],
    channelsById: byId,
    isLabelOpen: () => true,
  });
  expect(
    sections.filter(
      (row) => row.kind === 'conversation' && row.channel.id === 'acme'
    )
  ).toHaveLength(3);
  expect(
    sections
      .filter((row) => row.kind === 'conversation' && !row.labelId)
      .map((row) => row.kind === 'conversation' && row.channel.id)
  ).toEqual(['deals']);
  const rows = buildChannelRailRows(
    'browse',
    {
      favorites: true,
      team_channels: true,
      channels: true,
      direct_messages: true,
    },
    {
      favorites: [],
      team_channels: [acme, zeta, deals],
      channels: [],
      direct_messages: [],
      recents: [],
      threads: [],
    },
    sections
  );
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  expect(
    rows
      .filter((row) => row.kind === 'conversation' && row.channel.id === 'acme')
      .map((row) => row.id)
  ).toEqual([
    'channel:acme:label:smart-1',
    'channel:acme:label:smart-2',
    'channel:acme:label:manual',
  ]);
  const collapsed = buildChannelSectionRows({
    labels,
    channels: [acme, zeta, deals],
    channelsById: byId,
    isLabelOpen: () => false,
  });
  expect(collapsed.filter((row) => row.kind === 'conversation')).toEqual([
    { kind: 'conversation', channel: deals },
  ]);
});

describe('section preferences', () => {
  it('filters one section without leaking its read members or filtering another section', () => {
    const read = channel('read');
    const unread = channel('unread');
    const plain = channel('plain');
    const dmRead = channel('dm-read', 'Read DM', 'direct_message');
    const dmUnread = channel('dm-unread', 'Unread DM', 'direct_message');
    const channelsById = new Map(
      [read, unread, plain, dmRead, dmUnread].map((item) => [item.id, item])
    );
    const sections = buildChannelSectionRows({
      labels: [
        label('filtered', 'Filtered', ['read', 'unread']),
        label('all', 'All', ['read', 'unread']),
      ],
      channels: [read, unread, plain],
      channelsById,
      isLabelOpen: () => true,
    });
    const rows = buildChannelRailRows(
      'browse',
      {
        favorites: true,
        team_channels: true,
        channels: true,
        direct_messages: true,
      },
      {
        favorites: [],
        team_channels: [read, unread, plain],
        channels: [],
        direct_messages: [dmRead, dmUnread],
        recents: [],
        threads: [],
      },
      sections,
      {
        preferences: {
          'label:filtered': { unreadOnly: true },
          direct_messages: { unreadOnly: true },
        },
        channelById: (id) => channelsById.get(id),
        unreadChannelIds: new Set(['unread', 'dm-unread']),
      }
    );
    expect(rows.map((row) => row.id)).toEqual([
      'section:favorites',
      'section:team_channels',
      'channel:plain',
      'status:team_channels',
      'label:filtered',
      'channel:unread:label:filtered',
      'label:all',
      'channel:read:label:all',
      'channel:unread:label:all',
      'section:direct_messages',
      'channel:dm-unread',
    ]);
    expect(rows.at(-1)).toMatchObject({ localIndex: 0 });
    expect(rows[5]).toMatchObject({ localIndex: 5 });
  });

  it('sorts overlapping sections independently and keeps empty filtered headings pageable', () => {
    const older = { ...channel('older', 'Alpha'), createdAt: '2026-01-01' };
    const newer = { ...channel('newer', 'Zeta'), createdAt: '2026-02-01' };
    const channelsById = new Map([older, newer].map((item) => [item.id, item]));
    const sections = buildChannelSectionRows({
      labels: [
        label('recent', 'Recent', ['older', 'newer']),
        label('alphabetical', 'Alphabetical', ['older', 'newer']),
      ],
      channels: [older, newer],
      channelsById,
      isLabelOpen: () => true,
    });
    const expanded = {
      favorites: true,
      team_channels: true,
      channels: true,
      direct_messages: true,
    };
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        team_channels: [older, newer],
        channels: [],
        direct_messages: [],
        recents: [],
        threads: [],
      },
      sections,
      {
        preferences: {
          'label:recent': { sort: 'created_at' },
          team_channels: { unreadOnly: true },
        },
        channelById: (id) => channelsById.get(id),
        unreadChannelIds: new Set(),
      }
    );
    expect(
      rows.filter((row) => row.kind === 'conversation').map((row) => row.id)
    ).toEqual([
      'channel:newer:label:recent',
      'channel:older:label:recent',
      'channel:older:label:alphabetical',
      'channel:newer:label:alphabetical',
    ]);
    const heading = rows.find((row) => row.id === 'section:team_channels')!;
    expect(getChannelRailPaginationScope(heading, rows, expanded)).toBe(
      'team_channels'
    );
  });
});
