import type { ChannelEntity } from '@entity';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { canLabelChannel } from '../../core/channel-label-eligibility';
import type {
  ChannelsQueryScope,
  ChannelsRailSection,
  ChannelsTab,
} from '../../types';
import {
  type ChannelRailRow,
  type ChannelSectionRow,
  rowKeyForChannel,
  rowKeyForFavorite,
  rowKeyForLabel,
} from './ChannelsRailContext';

export type ChannelRailItemsByScope = Record<
  ChannelsQueryScope,
  readonly ChannelEntity[]
> & {
  favorites: readonly Favorite[];
};

const compareChannelName = (left: ChannelEntity, right: ChannelEntity) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
  left.id.localeCompare(right.id);

/**
 * Lay out the Channels section: each label in saved order with the
 * channels the user can see in it (A→Z, the same for everyone), then the
 * channels in no label in the section's own sort. Empty labels stay visible as drop targets; a collapsed label hides its channels.
 *
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
          channel !== undefined && canLabelChannel(channel)
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
 * The keyboard-navigable rows of the All tab (or the flat Recent list), in
 * visual order. Collapsed sections contribute only their heading.
 */
export function buildChannelRailRows(
  tab: ChannelsTab,
  expandedGroups: Record<ChannelsRailSection, boolean>,
  items: ChannelRailItemsByScope,
  channelSectionRows: readonly ChannelSectionRow[]
): ChannelRailRow[] {
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

  rows.push({
    kind: 'section',
    id: 'section:channels',
    group: 'channels',
  });
  if (expandedGroups.channels) {
    rows.push(
      ...channelSectionRows.map(
        (row, localIndex): ChannelRailRow =>
          row.kind === 'label'
            ? {
                kind: 'label',
                id: rowKeyForLabel(row.label.id),
                group: 'channels',
                localIndex,
                label: row.label,
              }
            : {
                kind: 'conversation',
                id: rowKeyForChannel(row.channel.id, row.labelId),
                group: 'channels',
                scope: 'channels',
                localIndex,
                channel: row.channel,
                labelId: row.labelId,
              }
      )
    );
  }

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
          id: `channel:${channel.id}`,
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
