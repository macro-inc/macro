import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

const EXPERIMENTAL_APP_LAYOUT_STORAGE_KEY =
  'macro:pref:experimental-app-layout';

/**
 * Device-local switch for the reversible app layout experiment.
 *
 * This intentionally defaults to the classic experience and is shared at
 * module scope so the command menu, sidebar, and soup views update together
 * without a reload.
 */
export const [experimentalAppLayoutEnabled, setExperimentalAppLayoutEnabled] =
  makePersisted(createSignal(false), {
    name: EXPERIMENTAL_APP_LAYOUT_STORAGE_KEY,
  });

/** Toggle between the classic and experimental desktop app layouts. */
export function toggleExperimentalAppLayout(): boolean {
  const enabled = !experimentalAppLayoutEnabled();
  setExperimentalAppLayoutEnabled(enabled);
  return enabled;
}
