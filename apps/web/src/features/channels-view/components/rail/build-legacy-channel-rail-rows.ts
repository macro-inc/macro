import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelsRailSection, ChannelsTab } from '../../types';
import {
  buildChannelRailRows,
  buildChannelSectionRows,
  type ChannelRailItemsByScope,
} from './build-channel-rail-rows';
import {
  type ChannelRailRow,
  type ChannelSectionRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForLabel,
} from './ChannelsRailContext';

/** The original label rollout groups only team channels, inside Team channels. */
export function buildLegacyChannelSectionRows(options: {
  labels: readonly ChannelLabel[];
  channels: readonly ChannelEntity[];
  channelsById: ReadonlyMap<string, ChannelEntity>;
  isLabelOpen: (labelId: string) => boolean;
}): ChannelSectionRow[] {
  return buildChannelSectionRows({
    ...options,
    channels: options.channels.filter(
      (channel) => channel.channelType === 'team'
    ),
    channelsById: new Map(
      [...options.channelsById].filter(
        ([, channel]) => channel.channelType === 'team'
      )
    ),
  });
}

/** Original tabbed rail ordering and per-section virtualizer indexes. */
export function buildLegacyChannelRailRows(
  tab: ChannelsTab,
  expandedGroups: Record<ChannelsRailSection, boolean>,
  items: ChannelRailItemsByScope,
  channelSectionRows: readonly ChannelSectionRow[]
): ChannelRailRow[] {
  if (tab !== 'browse') {
    return buildChannelRailRows(tab, expandedGroups, items, channelSectionRows);
  }

  const rows: ChannelRailRow[] = [];
  if (items.favorites.length > 0) {
    rows.push({
      kind: 'section',
      id: 'section:favorites',
      group: 'favorites',
    });
    if (expandedGroups.favorites) {
      rows.push(
        ...items.favorites.map(
          (favorite): ChannelRailRow => ({
            kind: 'favorite',
            id: rowKeyForFavorite(favorite),
            group: 'favorites',
            favorite,
          })
        )
      );
    }
  }

  rows.push({
    kind: 'section',
    id: 'section:team_channels',
    group: 'team_channels',
  });
  if (expandedGroups.team_channels) {
    rows.push(
      ...channelSectionRows.map(
        (row, localIndex): ChannelRailRow =>
          row.kind === 'label'
            ? {
                kind: 'label',
                id: rowKeyForLabel(row.label.id),
                group: 'team_channels',
                localIndex,
                label: row.label,
              }
            : {
                kind: 'conversation',
                id: rowKeyForChannel(row.channel.id, row.labelId),
                group: 'team_channels',
                scope: 'team_channels',
                localIndex,
                channel: row.channel,
                labelId: row.labelId,
              }
      )
    );
  }

  for (const group of ['channels', 'direct_messages'] as const) {
    rows.push({ kind: 'section', id: `section:${group}`, group });
    if (!expandedGroups[group]) continue;
    rows.push(
      ...items[group].map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: rowKeyForChannel(channel.id),
          group,
          scope: group,
          localIndex,
          channel,
        })
      )
    );
  }

  return rows;
}
