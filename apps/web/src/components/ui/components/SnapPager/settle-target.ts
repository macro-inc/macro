export interface SettleTargetInput {
  /** Displacement from the committed page after native momentum ends. */
  distance: number;
  width: number;
  /** Release speed, sampled during the last 80ms of a held gesture. */
  releaseVelocity?: number;
  maxPages: number;
}

/** Slow drags need half a page; a deliberate flick can complete a shorter move. */
export function settleTarget({
  distance,
  width,
  releaseVelocity = 0,
  maxPages,
}: SettleTargetInput) {
  if (width <= 0 || !Number.isFinite(distance)) return 0;
  const pages = Math.abs(distance) / width;
  let moved = Math.ceil(pages - 0.5);
  const flick =
    Math.abs(releaseVelocity) >= 0.5 &&
    Math.abs(distance) >= Math.min(40, width * 0.1);
  if (
    moved === 0 &&
    flick &&
    Math.sign(releaseVelocity) === Math.sign(distance)
  )
    moved = 1;
  return moved === 0 ? 0 : Math.sign(distance) * Math.min(maxPages, moved);
}
