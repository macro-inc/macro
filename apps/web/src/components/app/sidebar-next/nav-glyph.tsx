import { cn } from '@ui';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** Any SVG component — in practice the Phosphor icons `nav-items` imports. */
export type NavIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

const SWAP = cn(
  'absolute inset-0 transition-opacity duration-150 ease-out',
  'motion-reduce:transition-none'
);

/**
 * A nav glyph, optionally cross-fading to a filled counterpart.
 *
 * Both weights are stacked in the same square box and swapped by opacity
 * alone, so neither reflows its button and the outline glyph does not blink out
 * before the filled one arrives. Phosphor glyphs are `fill="currentColor"`, so
 * the caller's text colour — an active nav button's `text-accent` included —
 * carries into both.
 */
export const NavGlyph = (props: {
  icon: NavIcon;
  /** Filled counterpart of `icon`. Omit to keep one glyph in every state. */
  iconActive?: NavIcon;
  /** Cross-fades `iconActive` in. Ignored when there isn't one. */
  filled?: boolean;
  /** Sizes the box and, with it, both glyphs — e.g. `size-5`. */
  class: string;
}) => (
  <div
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
