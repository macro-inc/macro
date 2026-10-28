/** Fine dots emerge gently as they spread out; coarser dots stay steady.
 * Three overlapping powers of four cover every readable level. The coarsest
 * is always opaque, so dropping a redundant coarser level cannot cause a pop.
 */
export function dotGridLevels(scale: number) {
  const smallest =
    4 ** Math.max(0, Math.floor(Math.log(16 / scale) / Math.log(4)));
  return [smallest, smallest * 4, smallest * 16].map((unit) => ({
    unit,
    spacing: unit * scale,
    opacity: Math.max(0, Math.min(1, (unit * scale - 4) / 32)),
  }));
}
