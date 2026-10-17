import { type Accessor, createEffect, on } from 'solid-js';

type Anchor = { id: string; top: number };

/** A row past the first one keeps the anchor when the first is the one removed. */
const ANCHOR_CANDIDATES = 3;

/**
 * Keeps the rows on screen where they are when rows are added or removed
 * above them: new mail arriving, or a thread marked done from elsewhere.
 * Without it the list's content shifts under the user while the scroll
 * offset stays put. At the top of the list nothing is anchored, so new mail
 * shows up there.
 *
 * Rows are found by their DOM `id`, which is their row id.
 */
export function createScrollAnchor(options: {
  scroller: Accessor<HTMLElement | undefined>;
  rows: Accessor<readonly { id: string }[]>;
}) {
  let anchors: Anchor[] = [];

  /** Records where the first rows on screen are; call on every scroll. */
  const capture = () => {
    const scroller = options.scroller();
    anchors = [];
    if (!scroller || scroller.scrollTop <= 0) return;
    const viewTop = scroller.getBoundingClientRect().top;
    // Virtualized rows are positioned, so DOM order is not screen order.
    anchors = [...scroller.querySelectorAll<HTMLElement>('[role="row"][id]')]
      .map((element) => ({
        id: element.id,
        top: element.getBoundingClientRect().top,
      }))
      .filter((anchor) => anchor.top >= viewTop)
      .sort((left, right) => left.top - right.top)
      .slice(0, ANCHOR_CANDIDATES);
  };

  // The virtualizer positions the new rows in the same flush, so the anchor's
  // move is measurable here, before the user sees a frame of it.
  createEffect(
    on(
      options.rows,
      () => {
        const scroller = options.scroller();
        if (!scroller) return;
        for (const anchor of anchors) {
          const element = scroller.ownerDocument.getElementById(anchor.id);
          if (!element || !scroller.contains(element)) continue;
          const moved = element.getBoundingClientRect().top - anchor.top;
          if (Math.abs(moved) >= 1) scroller.scrollTop += moved;
          break;
        }
        capture();
      },
      { defer: true }
    )
  );

  return { capture };
}
