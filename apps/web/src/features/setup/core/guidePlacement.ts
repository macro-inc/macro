export type GuideRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Prefer the right of the feature; keep the card inside its split and viewport. */
export function placeGuide(
  bounds: GuideRect,
  target: GuideRect | undefined,
  width: number,
  height: number
) {
  const gap = 16;
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const candidates = target
    ? [
        { left: target.left + target.width + gap, top: target.top },
        { left: target.left - width - gap, top: target.top },
        { left: target.left, top: target.top + target.height + gap },
        { left: target.left, top: target.top - height - gap },
      ]
    : [];
  const fits = (p: { left: number; top: number }) =>
    p.left >= bounds.left + gap &&
    p.left + width <= right - gap &&
    p.top >= bounds.top + gap &&
    p.top + height <= bottom - gap;
  const position = candidates.find(fits) ??
    candidates.find(
      (p) => p.left >= bounds.left + gap && p.left + width <= right - gap
    ) ?? { left: right - width - gap, top: bounds.top + 88 };
  return {
    left: Math.max(
      bounds.left + gap,
      Math.min(position.left, right - width - gap)
    ),
    top: Math.max(
      bounds.top + gap,
      Math.min(position.top, bottom - height - gap)
    ),
  };
}
