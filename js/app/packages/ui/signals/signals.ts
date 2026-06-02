import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';

/**
 * Globally enables or disables the appearance of tooltips across the app.
 * Persisted to localStorage so the preference survives reloads.
 */
export const [tooltipsEnabled, setTooltipsEnabled] = makePersisted(
  createSignal<boolean>(true),
  { name: 'ui.tooltipsEnabled' }
);

/**
 * When enabled, all entity icons render in a single monochrome color
 * instead of their default per-type colors.
 */
export const [monochromeIcons, setMonochromeIcons] = makePersisted(
  createSignal<boolean>(false),
  { name: 'enable-monochrome-icons' }
);
