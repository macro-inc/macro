import Check from '@phosphor/check.svg';
import { cn, Dropdown } from '@ui';
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

/**
 * Inline checkbox affordance — a small square that fills accent when checked
 * and shows an outlined empty box when not. Matches the soup-menu checkbox
 * pattern. Visual-only; pair with a clickable parent for the actual toggle.
 */
export const InlineCheckbox: Component<{ checked: boolean }> = (props) => (
  <span
    aria-hidden
    class={cn(
      'inline-flex items-center justify-center size-3.5 shrink-0 rounded-sm',
      props.checked
        ? 'bg-accent text-surface'
        : 'bg-transparent border border-edge-muted text-transparent'
    )}
  >
    <Check class="size-2.5" />
  </span>
);
