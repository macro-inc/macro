import type { JSX } from 'solid-js';

// Shared chrome for the "app window" mockups used both as standalone page heroes
// and inside the home app-preview. Centralises the common shell — rounded card,
// 7px padding, hairline border, window shadow, and the dark inner surface — so
// every window stays consistent. The bits that legitimately differ per window
// (background tint, bottom fade mask, keyboard interactivity) are props.

const DEFAULT_BG = 'color-mix(in srgb, var(--b1) 58%, var(--b0))';
/** The window's inner surface. Exported so embedded content (e.g. the live
 * editor iframe) can paint the same colour instead of guessing at it. */
export const PREVIEW_INNER_BG = '#0D0D0D';
const INNER_BG = PREVIEW_INNER_BG;

export function PreviewWindow(props: {
  /** Identifies the window for the app-preview's scoped overrides. */
  class: string;
  children: JSX.Element;
  /** Outer card tint. Defaults to the shared b1/b0 mix. */
  background?: string;
  /** Inner (content) surface. Defaults to #0D0D0D. */
  innerBackground?: string;
  /** Bottom-fade mask gradient. Omit for no mask (e.g. the agents window). */
  mask?: string;
  /** Makes the window a keyboard-navigable region (email, calls demos). */
  interactive?: {
    ariaLabel: string;
    onKeyDown: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>;
  };
}) {
  const style = (): JSX.CSSProperties => ({
    'background-color': props.background ?? DEFAULT_BG,
    border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
    'border-radius': '12px',
    'box-shadow': 'var(--shadow-window)',
    'box-sizing': 'border-box',
    ...(props.mask
      ? { '-webkit-mask-image': props.mask, 'mask-image': props.mask }
      : {}),
    ...(props.interactive ? { outline: 'none' } : {}),
    overflow: 'hidden',
    padding: '7px',
    width: '100%',
  });
  return (
    <div
      class={props.class}
      tabindex={props.interactive ? 0 : undefined}
      role={props.interactive ? 'application' : undefined}
      aria-label={props.interactive?.ariaLabel}
      onKeyDown={props.interactive?.onKeyDown}
      style={style()}
    >
      <div
        style={{
          'background-color': props.innerBackground ?? INNER_BG,
          // Concentric with the card: outer 12px − 7px padding = 5px. (In the
          // app-preview the card radius + padding are overridden to keep this
          // relationship; see SceneAppPreview's scoped overrides.)
          'border-radius': '5px',
          display: 'grid',
          'grid-template-columns': 'minmax(0, 1fr)',
          overflow: 'hidden',
          'text-align': 'left',
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
