/**
 * How an agent-opened pane arrives on desktop, and how Undo takes it away.
 *
 * Today a split appears at once, which is fine when the person asked for it.
 * When an agent opens one, nothing the person did explains the change, so the
 * new pane slides in from the side it lands on while the panes it pushes
 * glide to their new places (FLIP on `transform`). Undo plays the same path
 * backwards. Widths still change at once: only position and opacity move.
 * Reduced motion keeps a short fade and no movement. Phones push the pane
 * onto the stack, which has its own slide.
 */

import type { PaneId } from '@app/lib/split-router';

const ARRIVE_MS = 260;
const LEAVE_MS = 200;
const FADE_MS = 160;
/** Strong ease-out: moving at once, settling softly. */
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** How far the arriving pane travels, from the side it lands on. */
const TRAVEL_PX = 28;

export type PaneRects = ReadonlyMap<PaneId, DOMRect>;

/** The element a tiled pane renders in (`data-split-pane` in TiledSplits). */
export function paneElement(pane: PaneId): HTMLElement | undefined {
  for (const element of document.querySelectorAll('[data-split-pane]')) {
    if (element instanceof HTMLElement && element.dataset.splitPane === pane) {
      return element;
    }
  }
}

function reducedMotion(): boolean {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
  );
}

/**
 * Nobody is watching a hidden tab, and it paints no frames to animate; an
 * environment without the Web Animations API shows the end state.
 */
function watched(): boolean {
  return (
    document.visibilityState === 'visible' &&
    typeof Element.prototype.animate === 'function'
  );
}

/** Where the panes are now, to animate from once the layout changes. */
export function capturePaneRects(panes: readonly PaneId[]): PaneRects {
  const rects = new Map<PaneId, DOMRect>();

  for (const pane of panes) {
    const element = paneElement(pane);
    if (element) rects.set(pane, element.getBoundingClientRect());
  }

  return rects;
}

/** Glide panes from where they were to where the new layout put them. */
function glide(before: PaneRects, duration: number) {
  for (const [pane, rect] of before) {
    const element = paneElement(pane);
    if (!element) continue;

    const now = element.getBoundingClientRect();
    const dx = rect.left - now.left;
    const dy = rect.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration, easing: EASE_OUT }
    );
  }
}

/** The side of the layout a pane sits nearer, which it travels from. */
function travel(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const parent = element.parentElement?.getBoundingClientRect();
  if (!parent) return TRAVEL_PX;

  const centre = rect.left + rect.width / 2;
  const parentCentre = parent.left + parent.width / 2;

  return centre >= parentCentre ? TRAVEL_PX : -TRAVEL_PX;
}

/**
 * Bring `arrived` in and glide the panes it moved, from where they were in
 * `before`. Call once the new layout has rendered.
 */
export function playArrival(arrived: PaneId, before: PaneRects) {
  if (!watched()) return;

  const element = paneElement(arrived);
  if (!element) return;

  if (reducedMotion()) {
    element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_MS,
      easing: 'ease',
    });
    return;
  }

  glide(before, ARRIVE_MS);
  element.animate(
    [
      { opacity: 0, transform: `translateX(${travel(element)}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ],
    { duration: ARRIVE_MS, easing: EASE_OUT }
  );
}

/**
 * Send `pane` back the way it came, from wherever it is mid-arrival, and
 * resolve when it has gone (at once when nobody is watching).
 */
export async function playDeparture(pane: PaneId): Promise<void> {
  const element = paneElement(pane);
  if (!element || !watched()) return;

  // Start from what is on screen, so an Undo during the arrival reverses it
  // instead of jumping to the end first.
  const style = getComputedStyle(element);
  const from = { opacity: style.opacity, transform: style.transform };
  for (const running of element.getAnimations()) running.cancel();

  const keyframes = reducedMotion()
    ? [{ opacity: from.opacity }, { opacity: 0 }]
    : [
        from.transform === 'none'
          ? { opacity: from.opacity, transform: 'translateX(0)' }
          : from,
        { opacity: 0, transform: `translateX(${travel(element)}px)` },
      ];
  const animation = element.animate(keyframes, {
    duration: reducedMotion() ? FADE_MS : LEAVE_MS,
    easing: EASE_OUT,
    fill: 'forwards',
  });

  try {
    await animation.finished;
  } catch {
    // Cancelled because the pane went away first; nothing left to show.
  }
}

/** After Undo, glide the remaining panes back to their old places. */
export function playSettle(before: PaneRects) {
  if (!watched() || reducedMotion()) return;

  glide(before, LEAVE_MS);
}
