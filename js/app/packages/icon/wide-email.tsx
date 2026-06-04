import { createEffect } from 'solid-js';

// All coordinates are stroke-centers (inset from the visual edges by half the stroke).
// The body is two C-shaped strokes that meet at the left/right edge midpoints:
//   BODY_A = upper half (rounds the top-left + top-right corners)
//   BODY_B = lower half (rounds the bottom-left + bottom-right corners)
// Each corner is a real r=1.5 arc (cubic), so every command is mirrored M,L,C,L,C,L by
// its paper-plane target — the plane's corner cubics are degenerate (collapsed onto a
// single vertex), so the rounded corners smoothly shrink to the plane's sharp points.
// Corner→destination is preserved from the original: TL→tail, TR→nose, BL/BR→tip.

// ── Email (source) ───────────────────────────────────────────────────────────
const BODY_A_D =
  'M 17.53125,5.96875 L 17.53125,1.96875 C 17.53125,1.1403 16.8597,0.46875 16.03125,0.46875 L 1.96875,0.46875 C 1.1403,0.46875 0.46875,1.1403 0.46875,1.96875 L 0.46875,5.96875';
const BODY_B_D =
  'M 0.46875,5.96875 L 0.46875,9.96875 C 0.46875,10.7972 1.1403,11.46875 1.96875,11.46875 L 16.03125,11.46875 C 16.8597,11.46875 17.53125,10.6403 17.53125,9.96875 L 17.53125,5.96875';
const FLAP_D = 'M 0.90825,0.90825 L 9,6.75 L 17.09175,0.90825';

// ── Paper plane (target) ─────────────────────────────────────────────────────
const PLANE_A_D =
  'M 10.875,6 L 17.25,0.75 C 17.25,0.75 17.25,0.75 17.25,0.75 L 0.75,1 C 0.75,1 0.75,1 0.75,1 L 2.625,6.125';
const PLANE_B_D =
  'M 2.625,6.125 L 4.5,11.25 C 4.5,11.25 4.5,11.25 4.5,11.25 L 4.5,11.25 C 4.5,11.25 4.5,11.25 4.5,11.25 L 10.875,6';
const PLANE_C_D = 'M 0.75,1 L 4.5,11.25 L 17.25,0.75';

// ── Cutout triangle (fades in over paper plane) ───────────────────────────────
// Derived from the inner notch in paper-plane-cutout.svg, scaled 24→18 (×0.75).
const CUTOUT_D = 'M 3.3,6.8 L 7.1,4.3 L 2.65,4.9 Z';

// CSS `d` property requires path() wrapper for cross-browser WAAPI support
const p = (d: string) => `path('${d}')`;

const DURATION = 400;
const EASING = 'ease-in-out';

// Bake the current animated value into inline style then remove the animation.
// Swallows the finished-promise rejection that cancel() triggers.
function cancelAnim(a: Animation) {
  a.finished.catch(() => {});
  try {
    a.commitStyles();
    a.cancel();
  } catch (_) {}
}

export const AnimatedEmailIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  let bodyAEl!: SVGPathElement;
  let bodyBEl!: SVGPathElement;
  let flapEl!: SVGPathElement;
  let cutoutEl!: SVGPathElement;
  let prevTrigger = false;
  let morphAnims: Animation[] = [];
  // Kept alive between trigger cycles so we always have a reference to reverse it.
  let cutoutAnim: Animation | null = null;

  createEffect(() => {
    const trigger = !!props.triggerAnimation;
    if (trigger === prevTrigger) return;
    prevTrigger = trigger;

    if (trigger) {
      // Cancel any in-progress morphs
      for (const a of morphAnims) cancelAnim(a);
      morphAnims = [];

      // Cancel cutout WITHOUT commitStyles — let it snap back to its base style.
      // The new animation's fill:'both' immediately applies opacity:0, overriding
      // any residual inline opacity before the next paint.
      if (cutoutAnim) {
        cutoutAnim.finished.catch(() => {});
        try {
          cutoutAnim.cancel();
        } catch (_) {}
        cutoutAnim = null;
      }

      flapEl.setAttribute('stroke-linejoin', 'round');

      const opts = {
        duration: DURATION,
        easing: EASING,
        fill: 'forwards' as FillMode,
      };
      morphAnims = [
        bodyAEl.animate([{ d: p(BODY_A_D) }, { d: p(PLANE_A_D) }], opts),
        bodyBEl.animate([{ d: p(BODY_B_D) }, { d: p(PLANE_B_D) }], opts),
        flapEl.animate([{ d: p(FLAP_D) }, { d: p(PLANE_C_D) }], opts),
      ];
      // fill:'both' applies the first keyframe (opacity:0) during the delay phase,
      // guarding against residual inline opacity from a previous cycle.
      cutoutAnim = cutoutEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: DURATION,
        easing: EASING,
        fill: 'both' as FillMode,
        delay: DURATION,
      });

      // Bake morph shapes when they finish; leave cutoutAnim alive to reverse later.
      Promise.all(morphAnims.map((a) => a.finished))
        .then(() => {
          for (const a of morphAnims) cancelAnim(a);
          morphAnims = [];
        })
        .catch(() => {});
    } else {
      // ── Reverse morphs ────────────────────────────────────────────────────
      const isActive = (a: Animation) => a.playState === 'running';

      for (const a of morphAnims.filter((a) => !isActive(a))) cancelAnim(a);
      const running = morphAnims.filter(isActive);

      if (running.length > 0) {
        for (const a of running) a.reverse();
        morphAnims = running;
      } else {
        const revOpts = {
          duration: DURATION,
          easing: EASING,
          fill: 'forwards' as FillMode,
          direction: 'reverse' as PlaybackDirection,
        };
        morphAnims = [
          bodyAEl.animate([{ d: p(BODY_A_D) }, { d: p(PLANE_A_D) }], revOpts),
          bodyBEl.animate([{ d: p(BODY_B_D) }, { d: p(PLANE_B_D) }], revOpts),
          flapEl.animate([{ d: p(FLAP_D) }, { d: p(PLANE_C_D) }], revOpts),
        ];
      }

      // ── Reverse cutout ────────────────────────────────────────────────────
      // reverse() uses the animation's own keyframes — no commitStyles needed,
      // so no inline opacity can be stranded under rapid trigger cycles.
      if (cutoutAnim) {
        const inDelayPhase = Number(cutoutAnim.currentTime ?? 0) < DURATION; // delay === DURATION
        if (inDelayPhase) {
          // fill:'both' is holding opacity:0; just cancel.
          cutoutAnim.finished.catch(() => {});
          try {
            cutoutAnim.cancel();
          } catch (_) {}
          cutoutAnim = null;
        } else {
          // Active phase or finished — reverse() fades back to opacity:0.
          try {
            cutoutAnim.reverse();
          } catch (_) {}
        }
      }

      // ── Cleanup when everything settles ──────────────────────────────────
      const morphsToWatch = [...morphAnims];
      const cutoutToWatch = cutoutAnim;
      const allToWatch = [
        ...morphsToWatch,
        ...(cutoutToWatch ? [cutoutToWatch] : []),
      ];

      Promise.all(allToWatch.map((a) => a.finished))
        .then(() => {
          for (const a of morphsToWatch) cancelAnim(a);
          if (cutoutToWatch) cancelAnim(cutoutToWatch);
          morphAnims = [];
          // Only null cutoutAnim if it hasn't been replaced by a newer animation
          if (cutoutAnim === cutoutToWatch) cutoutAnim = null;
          flapEl.setAttribute('stroke-linejoin', 'round');
        })
        .catch(() => {});
    }
  });

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      {/*<title>Animated email icon</title>*/}
      <path ref={bodyAEl} d={BODY_A_D} stroke-linejoin="round" />
      <path ref={bodyBEl} d={BODY_B_D} stroke-linejoin="round" />
      <path ref={flapEl} d={FLAP_D} />
      <path
        ref={cutoutEl}
        d={CUTOUT_D}
        fill="currentColor"
        stroke="none"
        style={{ opacity: 0 }}
      />
    </svg>
  );
};
