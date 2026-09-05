/** Floor so a leftover wide canvas (newsletter table) can shrink a little
 * without collapsing type the way unbounded `pane / content` zoom does. */
export const FIT_TO_WIDTH_ZOOM_FLOOR = 0.7;

export function fitToWidthZoom(args: {
  containerWidth: number;
  contentWidth: number;
}): { zoom: number; overflowsAfterZoom: boolean } | undefined {
  const { containerWidth, contentWidth } = args;
  if (containerWidth <= 0 || contentWidth <= containerWidth) {
    return undefined;
  }
  const zoom = Math.max(FIT_TO_WIDTH_ZOOM_FLOOR, containerWidth / contentWidth);
  return {
    zoom,
    overflowsAfterZoom: contentWidth * zoom > containerWidth + 1,
  };
}
