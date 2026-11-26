/** Shared mobile chrome falloff and gradient stops. */
export const MOBILE_EDGE_FADE_FALLOFF = 32;

export function mobileEdgeFade(
  edge: 'top' | 'bottom',
  surface = 'var(--color-surface)'
) {
  return edge === 'top'
    ? `linear-gradient(to bottom, ${surface} 10%, 70%, transparent)`
    : `linear-gradient(to top, ${surface}, 60%, transparent)`;
}
