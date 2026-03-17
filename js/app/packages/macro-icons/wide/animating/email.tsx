import { createEffect, createUniqueId } from 'solid-js';

// All coordinates are stroke-centers: path is inset 0.75px from visual edges on all sides.
// Body is two open L-shaped strokes; each stops 1.5px short of the missing corners.
// stroke-linejoin="round" on each path provides r=0.75 rounding at the surviving corners.

// ── Email (source) ───────────────────────────────────────────────────────────
const BODY_A_D = 'M 1.5,0.75 L 17.25,0.75 L 17.25,10.5';
const BODY_B_D = 'M 16.5,11.25 L 0.75,11.25 L 0.75,1.5';
const FLAP_D = 'M 1.5,1.5 L 9,7.5 L 17.25,0.75';

// ── Paper plane (target) ─────────────────────────────────────────────────────
const PLANE_A_D = 'M 1.5,0.75 L 17.25,0.75 L 4.5,11.25';
const PLANE_B_D = 'M 17.25,0.75 L 4.5,11.25 L 0.75,1';
const PLANE_C_D = 'M 0.75,1 L 4.5,11.25 L 17.25,0.75';

// ── Cutout triangle (fades in over paper plane) ───────────────────────────────
// Derived from the inner notch in paper-plane-cutout.svg, scaled 24→18 (×0.75).
const CUTOUT_D = 'M 3.5,6.7 L 7.3,4.2 L 2.85,4.8 Z';

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

export const AnimatedEmailIcon = (props: { triggerAnimation?: boolean }) => {
  const clipId = createUniqueId();
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
          flapEl.setAttribute('stroke-linejoin', 'miter');
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
      stroke-width="1.5"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/*<title>Animated email icon</title>*/}
      <defs>
        {/* Clips out the top-left 1.5×1.5 missing corner (visual coords 0,0 → 1.5,1.5) */}
        <clipPath id={clipId}>
          <path d="M 1.5,-3 L 18,-3 L 18,15 L 0,15 L 0,1.5 L 1.5,1.5 Z" />
        </clipPath>
      </defs>
      <g clip-path={`url(#${clipId})`}>
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
      </g>
    </svg>
  );
};
