import type { Bounds, Size } from './camera';
import {
  BOARD_ZONES,
  type BoardItem,
  type BoardZone,
  orderWithGroups,
} from './item';
import { type RegionMetrics, tileRegions } from './regions';

export const NEIGHBORHOOD_METRICS: RegionMetrics = {
  columnWidth: 288,
  header: 46,
  padding: 18,
  cellGap: 14,
  regionGap: 44,
};

export type NeighborhoodZone = {
  zone: BoardZone;
  bounds: Bounds;
  count: number;
  unread: number;
};

export type NeighborhoodLayout = {
  cards: ReadonlyMap<string, Bounds>;
  zones: NeighborhoodZone[];
  bounds: Bounds | undefined;
};

/** A first guess at a card's height until the card has been measured. */
export function estimateCardHeight(item: BoardItem, width: number): number {
  const charsPerLine = Math.max(18, Math.floor((width - 72) / 7));
  const bubbles = item.messages.reduce(
    (total, message) =>
      total +
      Math.min(3, Math.ceil(Math.max(1, message.text.length) / charsPerLine)) *
        18 +
      26,
    0
  );
  return 52 + Math.max(bubbles, 22);
}

/**
 * V1A. Every neighborhood is a framed region of conversation cards in
 * masonry columns; regions tile in neighborhood order so Channels leads and
 * quiet kinds fill the gaps.
 */
export function layoutNeighborhoods(
  items: readonly BoardItem[],
  measured: (key: string) => Size | undefined
): NeighborhoodLayout {
  const ordered = orderWithGroups(items);
  const members = (zone: BoardZone) =>
    ordered.filter((item) => item.zone === zone);

  const { regions, bounds } = tileRegions(
    BOARD_ZONES.map((zone) => {
      const zoneItems = members(zone);
      return {
        id: zone,
        count: zoneItems.length,
        height: (index: number, width: number) =>
          measured(zoneItems[index].key)?.height ??
          estimateCardHeight(zoneItems[index], width),
      };
    }),
    NEIGHBORHOOD_METRICS
  );

  const cards = new Map<string, Bounds>();
  const zones = regions.map((region) => {
    const zoneItems = members(region.id);
    zoneItems.forEach((item, index) =>
      cards.set(item.key, region.cells[index])
    );
    return {
      zone: region.id,
      bounds: region.bounds,
      count: zoneItems.length,
      unread: zoneItems.filter((item) => item.unreadCount > 0).length,
    };
  });

  return { cards, zones, bounds };
}
