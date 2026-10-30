import { type Bounds, unionBounds } from './camera';
import { masonry, skyline } from './geometry';

export type RegionSpec<TId> = {
  id: TId;
  count: number;
  /** A member's height at the column width its region gets. */
  height: (index: number, width: number) => number;
};

export type TiledRegion<TId> = {
  id: TId;
  bounds: Bounds;
  /** Member rectangles in world units, in input order. */
  cells: Bounds[];
};

export type RegionMetrics = {
  columnWidth: number;
  header: number;
  padding: number;
  cellGap: number;
  regionGap: number;
};

/** Busier regions get wider so they do not become one long column. */
export function regionSpan(count: number): number {
  if (count <= 3) return 1;
  if (count <= 8) return 2;
  return 3;
}

/**
 * Frames each group of cards as a region with a header, lays its cards out
 * in masonry columns, then tiles the regions on a skyline in input order so
 * leading groups stay top-left and small groups fill the gaps.
 */
export function tileRegions<TId>(
  specs: readonly RegionSpec<TId>[],
  metrics: RegionMetrics
): { regions: TiledRegion<TId>[]; bounds: Bounds | undefined } {
  const track = metrics.columnWidth + metrics.padding * 2;
  const regionWidth = (span: number) =>
    span * track + (span - 1) * metrics.regionGap;
  const cellWidth = (span: number) =>
    (regionWidth(span) - metrics.padding * 2 - (span - 1) * metrics.cellGap) /
    span;

  const blocks = specs
    .filter((spec) => spec.count > 0)
    .map((spec) => {
      const span = regionSpan(spec.count);
      const width = cellWidth(span);
      const content = masonry(
        Array.from({ length: spec.count }, (_, index) => ({
          width,
          height: spec.height(index, width),
        })),
        { columns: span, columnWidth: width, gap: metrics.cellGap }
      );
      return {
        spec,
        span,
        content,
        height: metrics.header + content.size.height + metrics.padding,
      };
    });

  const totalSpan = blocks.reduce((sum, block) => sum + block.span, 0);
  const widest = Math.max(1, ...blocks.map((block) => block.span));
  const tracks = Math.min(
    8,
    Math.max(widest, Math.round(Math.sqrt(totalSpan * 2.6)))
  );
  const origins = skyline(blocks, {
    tracks,
    trackWidth: track,
    gap: metrics.regionGap,
  });

  const regions = blocks.map((block, index) => {
    const origin = origins[index];
    return {
      id: block.spec.id,
      bounds: {
        x: origin.x,
        y: origin.y,
        width: regionWidth(block.span),
        height: block.height,
      },
      cells: block.content.placements.map((placement) => ({
        x: origin.x + metrics.padding + placement.x,
        y: origin.y + metrics.header + placement.y,
        width: placement.width,
        height: placement.height,
      })),
    };
  });

  return {
    regions,
    bounds: unionBounds(regions.map((region) => region.bounds)),
  };
}
