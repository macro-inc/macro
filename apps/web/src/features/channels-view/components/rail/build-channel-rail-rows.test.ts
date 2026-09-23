import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { describe, expect, it } from 'vitest';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
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
    channels: true,
    direct_messages: true,
  };

  it('lists channels once in their section and source order', () => {
    const rows = buildChannelRailRows(
      'browse',
      expanded,
      {
        favorites: [],
        channels: [acme, zeta],
        direct_messages: [],
        recents: [],
      },
      buildChannelSectionRows({
        labels: [],
        channels: [acme, zeta],
        channelsById: byId,
        isLabelOpen: () => true,
      })
    );

    expect(rows.map((row) => row.id)).toEqual([
      'section:channels',
      'channel:acme',
      'channel:zeta',
      'section:direct_messages',
    ]);
  });

  it('gives label headings and nested channels indexes into the rendered section', () => {
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
        channels: [deals],
        direct_messages: [],
        recents: [],
      },
      sectionRows
    );

    expect(rows.slice(1, 4)).toEqual([
      expect.objectContaining({ kind: 'label', id: 'label:l1', localIndex: 0 }),
      expect.objectContaining({
        kind: 'conversation',
        id: 'channel:acme:label:l1',
        localIndex: 1,
        labelId: 'l1',
        scope: 'channels',
      }),
      expect.objectContaining({
        kind: 'conversation',
        id: 'channel:deals',
        localIndex: 2,
        labelId: undefined,
      }),
    ]);
  });

  it('leaves the recent tab as a flat list', () => {
    const rows = buildChannelRailRows(
      'recents',
      expanded,
      {
        favorites: [],
        channels: [acme],
        direct_messages: [],
        recents: [zeta, acme],
      },
      []
    );
    expect(rows.map((row) => row.id)).toEqual(['channel:zeta', 'channel:acme']);
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
    { favorites: true, channels: true, direct_messages: true },
    {
      favorites: [],
      channels: [acme, zeta, deals],
      direct_messages: [],
      recents: [],
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
