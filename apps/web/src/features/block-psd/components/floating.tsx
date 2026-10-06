/**
 * Content drawn over the page next to an anchor (a swatch's picker), so a
 * scrolling panel cannot clip it: below the anchor, or above when there is
 * no room below, and kept inside the window. Presentational.
 */

import { createSignal, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

/** Space kept from the anchor and the window's edges, in pixels. */
const GAP = 4;
const MARGIN = 8;

export function Floating(props: {
  /** The anchor's rectangle on the page. */
  anchor: DOMRect;
  ref?: (element: HTMLDivElement) => void;
  testId?: string;
  class?: string;
  children: JSX.Element;
}) {
  const [place, setPlace] = createSignal({
    left: props.anchor.right,
    top: props.anchor.bottom + GAP,
    shown: false,
  });
  // Measured once the portal has put it in the page (after its ref).
  const measure = (panel: HTMLDivElement) =>
    queueMicrotask(() => {
      const r = panel.getBoundingClientRect();
      const below = props.anchor.bottom + GAP;
      const top =
        below + r.height + MARGIN <= window.innerHeight
          ? below
          : Math.max(MARGIN, props.anchor.top - GAP - r.height);
      const left = Math.max(
        MARGIN,
        Math.min(
          props.anchor.right - r.width,
          window.innerWidth - r.width - MARGIN
        )
      );
      setPlace({ left, top, shown: true });
    });
  return (
    <Portal>
      <div
        ref={(el) => {
          props.ref?.(el);
          measure(el);
        }}
        class={props.class}
        style={{
          position: 'fixed',
          'z-index': 50,
          left: `${place().left}px`,
          top: `${place().top}px`,
          // Measured before it shows, so it never jumps into place.
          visibility: place().shown ? 'visible' : 'hidden',
        }}
        data-testid={props.testId}
      >
        {props.children}
      </div>
    </Portal>
  );
}
