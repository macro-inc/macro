import {
  activeAppLayout,
  selectAppLayout,
} from '@app/features/app-layout/layout-state';

/** Compatibility accessor for behavior shared by all non-Classic layouts. */
export const experimentalAppLayoutEnabled = () =>
  activeAppLayout().capabilities.experimentalSurfaces;

/** Compatibility setter. New callers should select a registered layout id. */
export function setExperimentalAppLayoutEnabled(enabled: boolean) {
  selectAppLayout(enabled ? 'experimental-v1' : 'classic');
}

/** Compatibility binary toggle between Classic and the frozen v1 experiment. */
export function toggleExperimentalAppLayout(): boolean {
  const enabled = !experimentalAppLayoutEnabled();
  setExperimentalAppLayoutEnabled(enabled);
  return enabled;
}
