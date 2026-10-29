import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import type { ChannelsSourceScope } from '../../queries';
import type {
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import {
  ALL_THREADS_ROW_ID,
  type ChannelRailRow,
  type ChannelSectionRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForLabel,
} from './ChannelsRailContext';

export type ChannelRailItemsByScope = Record<
  ChannelsQueryScope | 'threads',
  readonly ChannelEntity[]
> & {
  favorites: readonly Favorite[];
};

const compareChannelName = (left: ChannelEntity, right: ChannelEntity) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
  left.id.localeCompare(right.id);

/**
 * Lay out top-level custom sections with their visible channels in A→Z order.
 * Ungrouped channels remain available to the primary sections.
 * Labelled channels come from `channelsById` because the paginated source
 * may not have reached them yet; anything unlabelled comes from `channels`
 * in source order.
 */
export function buildChannelSectionRows(options: {
  labels: readonly ChannelLabel[];
  channels: readonly ChannelEntity[];
  channelsById: ReadonlyMap<string, ChannelEntity>;
  isLabelOpen: (labelId: string) => boolean;
}): ChannelSectionRow[] {
  const rows: ChannelSectionRow[] = [];
  const labelled = new Set<string>();

  for (const label of options.labels) {
    const visible = label.channelIds
      .map((id) => options.channelsById.get(id))
      .filter(
        (channel): channel is ChannelEntity =>
          channel !== undefined && canLabelChannel(channel, label)
      )
      .sort(compareChannelName);

    for (const channel of visible) labelled.add(channel.id);
    rows.push({ kind: 'label', label });
    if (!options.isLabelOpen(label.id)) continue;
    for (const channel of visible) {
      rows.push({ kind: 'conversation', channel, labelId: label.id });
    }
  }

  for (const channel of options.channels) {
    if (labelled.has(channel.id)) continue;
    rows.push({ kind: 'conversation', channel });
  }

  return rows;
}

/**
 * Keyboard-navigable rows in visual order. Collapsed sections contribute
 * only their heading; restored list modes keep their flat row ordering.
 */
export function buildChannelRailRows(
  tab: ChannelsTab,
  expandedGroups: Record<ChannelsRailSection, boolean>,
  items: ChannelRailItemsByScope,
  channelSectionRows: readonly ChannelSectionRow[]
): ChannelRailRow[] {
  if (tab === 'threads') {
    return [
      { kind: 'all-threads', id: ALL_THREADS_ROW_ID },
      ...items.threads.map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: rowKeyForChannel(channel.id),
          scope: 'threads',
          localIndex,
          channel,
        })
      ),
    ];
  }

  if (tab === 'recents') {
    return items.recents.map((channel, localIndex) => ({
      kind: 'conversation',
      id: `channel:${channel.id}`,
      scope: 'recents',
      localIndex,
      channel,
    }));
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

  const labelledIds = new Set(
    channelSectionRows.flatMap((row) =>
      row.kind === 'conversation' && row.labelId ? [row.channel.id] : []
    )
  );
  // Membership still hides channels when their section is collapsed.
  for (const row of channelSectionRows) {
    if (row.kind === 'label') {
      for (const id of row.label.channelIds) labelledIds.add(id);
    }
  }

  for (const group of ['team_channels', 'channels'] as const) {
    const channels = items[group].filter(
      (channel) => !labelledIds.has(channel.id)
    );
    if (group === 'channels' && channels.length === 0) continue;
    rows.push({ kind: 'section', id: `section:${group}`, group });
    if (!expandedGroups[group]) continue;
    for (const channel of channels) {
      rows.push({
        kind: 'conversation',
        id: rowKeyForChannel(channel.id),
        group,
        scope: group,
        localIndex: 0,
        channel,
      });
    }
    rows.push({ kind: 'status', id: `status:${group}`, group });
  }

  for (const row of channelSectionRows) {
    if (row.kind === 'label') {
      rows.push({
        kind: 'label',
        id: rowKeyForLabel(row.label.id),
        group: 'team_channels',
        localIndex: 0,
        label: row.label,
      });
    } else if (row.labelId) {
      rows.push({
        kind: 'conversation',
        id: rowKeyForChannel(row.channel.id, row.labelId),
        group: 'team_channels',
        scope: 'team_channels',
        localIndex: 0,
        channel: row.channel,
        labelId: row.labelId,
      });
    }
  }
  // Every upper row shares one virtualizer and one scroll position.
  rows.forEach((row, index) => {
    if (row.kind === 'conversation' || row.kind === 'label')
      row.localIndex = index;
  });

  rows.push({
    kind: 'section',
    id: 'section:direct_messages',
    group: 'direct_messages',
  });
  if (expandedGroups.direct_messages) {
    rows.push(
      ...items.direct_messages.map(
        (channel, localIndex): ChannelRailRow => ({
          kind: 'conversation',
          id: rowKeyForChannel(channel.id),
          group: 'direct_messages',
          scope: 'direct_messages',
          localIndex,
          channel,
        })
      )
    );
  }

  return rows;
}

/** Page at the rendered section boundary, not a source tail hidden by a label. */
export function getChannelRailPaginationScope(
  row: ChannelRailRow,
  rows: readonly ChannelRailRow[],
  expanded: Readonly<Record<ChannelsRailSection, boolean>>
): ChannelsSourceScope | undefined {
  if (row.kind === 'section') {
    if (row.group === 'favorites' || !expanded[row.group]) return;
    const hasVisibleChannels = rows.some(
      (item) =>
        item.kind === 'conversation' &&
        !item.labelId &&
        item.scope === row.group
    );
    return hasVisibleChannels ? undefined : row.group;
  }
  if (row.kind !== 'conversation' || row.labelId) return;
  const last = rows.findLast(
    (item) =>
      item.kind === 'conversation' && !item.labelId && item.scope === row.scope
  );
  return last?.id === row.id ? row.scope : undefined;
}
