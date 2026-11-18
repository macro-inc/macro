import type { VirtualizerHandle } from 'virtua/solid';

type Geometry = Pick<
  VirtualizerHandle,
  'getItemOffset' | 'getItemSize' | 'scrollOffset' | 'viewportSize'
>;
type ScrollOptions = NonNullable<
  Parameters<VirtualizerHandle['scrollToIndex']>[1]
>;
type StickyLayout = {
  indexes: readonly number[];
  geometry: Geometry;
  startMargin: number;
  inset: number;
};

/** Find the last header at or before an offset without scanning every row. */
function findHeader(
  indexes: readonly number[],
  offset: number,
  getOffset: (index: number) => number
): number | undefined {
  let start = 0;
  let end = indexes.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (getOffset(indexes[middle]) <= offset) start = middle + 1;
    else end = middle;
  }
  return start > 0 ? indexes[start - 1] : undefined;
}

export function getStickyHeader(layout: StickyLayout) {
  const { indexes, geometry, startMargin, inset } = layout;
  const index = findHeader(
    indexes,
    geometry.scrollOffset + inset - startMargin,
    geometry.getItemOffset
  );
  if (index === undefined) return;
  const next = indexes[indexes.indexOf(index) + 1];
  const top =
    next === undefined
      ? inset
      : Math.min(
          inset,
          startMargin +
            geometry.getItemOffset(next) -
            geometry.scrollOffset -
            geometry.getItemSize(index)
        );
  return { index, top };
}

/** Return no scroll for a visible target, accounting for its pinned header. */
export function getStickyScrollOptions(
  layout: StickyLayout,
  index: number,
  options: ScrollOptions = {}
): ScrollOptions | undefined {
  const { indexes, geometry, startMargin, inset } = layout;
  const group = findHeader(indexes, index, (header) => header);
  const padding =
    inset +
    (group !== undefined && group !== index ? geometry.getItemSize(group) : 0);
  if (options.align !== 'nearest') {
    return {
      ...options,
      offset:
        (options.offset ?? 0) -
        (!options.align || options.align === 'start' ? padding : 0),
    };
  }
  const pinned = getStickyHeader(layout);
  if (index === pinned?.index && pinned.top >= inset) return;
  const top = startMargin + geometry.getItemOffset(index);
  if (top < geometry.scrollOffset + padding) {
    return {
      ...options,
      align: 'start',
      offset: (options.offset ?? 0) - padding,
    };
  }
  if (
    top + geometry.getItemSize(index) >
    geometry.scrollOffset + geometry.viewportSize
  ) {
    return { ...options, align: 'end' };
  }
}
