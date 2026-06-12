import { Dropdown } from '@ui';
import type { Component, JSX } from 'solid-js';

/**
 * Small section label rendered inside a `Dropdown.Group` (e.g. "Microphone",
 * "Audio processing"). Matches the soup filter/sort dropdown header tone.
 */
export const MenuLabel: Component<{ children: JSX.Element }> = (props) => (
  <div class="px-2 pt-0.5 pb-1 text-xs font-medium text-ink-muted">
    {props.children}
  </div>
);

/**
 * Hairline divider between sections inside a `Dropdown.Group`. Negative
 * horizontal margin lets the line bleed to the edges of the group surface.
 */
export const MenuDivider: Component = () => (
  <Dropdown.Separator class="my-1 h-px border-0 bg-edge-muted -mx-1.5" />
);
