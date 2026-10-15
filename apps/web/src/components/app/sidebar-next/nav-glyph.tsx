import { cn } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Any SVG component — the rail uses the original Macro icon family. */
export type NavIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

const SWAP = 'absolute inset-0';

/**
 * A nav glyph, instantly switching to a filled counterpart when active.
 *
 * Both weights are stacked in the same square box and swapped by opacity
 * alone, so neither reflows its button and the outline glyph does not blink out
 * before the filled one arrives. Both glyphs inherit currentColor from their
 * button, and share the same viewBox and optical center.
 */
export const NavGlyph = (props: {
  icon: NavIcon;
  /** Filled counterpart of `icon`. Omit to keep one glyph in every state. */
  iconActive?: NavIcon;
  /** Shows `iconActive` immediately. Ignored when there isn't one. */
  filled?: boolean;
  /** Sizes the box and, with it, both glyphs — e.g. `size-5`. */
  class: string;
}) => (
  <div
    data-icon-motion-target
    class={cn(
      'pointer-events-none relative flex shrink-0 items-center justify-center',
      props.class
    )}
  >
    <Show
      when={props.iconActive}
      fallback={<Dynamic component={props.icon} class="size-full" />}
    >
      {(iconActive) => (
        <>
          <Dynamic
            component={props.icon}
            aria-hidden="true"
            class={cn(SWAP, props.filled ? 'opacity-0' : 'opacity-100')}
          />
          <Dynamic
            component={iconActive()}
            aria-hidden="true"
            class={cn(SWAP, props.filled ? 'opacity-100' : 'opacity-0')}
          />
        </>
      )}
    </Show>
  </div>
);
