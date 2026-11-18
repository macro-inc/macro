import { createSignal } from 'solid-js';
/** Shared optional-section disclosure for anchored and agent placements. */
export function createComposerPresentation() {
  const [expanded, setExpanded] = createSignal(false);
  return { expanded, toggle: () => setExpanded((value) => !value) };
}
