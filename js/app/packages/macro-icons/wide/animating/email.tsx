import { createEffect, createUniqueId } from 'solid-js';

// All coordinates are stroke-centers: path is inset 0.75px from visual edges on all sides.
// Body is two open L-shaped strokes; each stops 1.5px short of the missing corners.
// stroke-linejoin="round" on each path provides r=0.75 rounding at the surviving corners.

// ── Email (source) ───────────────────────────────────────────────────────────
const BODY_A_D = 'M 1.5,0.75 L 17.25,0.75 L 17.25,10.5';
//   Top edge + right edge. Upper-right join rounded by stroke-linejoin.
const BODY_B_D = 'M 16.5,11.25 L 0.75,11.25 L 0.75,1.5';
//   Bottom edge + left edge. Lower-left join rounded by stroke-linejoin.
const FLAP_D = 'M 1.5,1.5 L 9,7.5 L 17.25,0.75';
//   3-point V spanning the top of the envelope.

// ── Paper plane (target) ─────────────────────────────────────────────────────
// Right-pointing plane; nose at (17.25,6), fold crease at (0.75,7.5).
const PLANE_A_D = 'M 1.5,0.75 L 17.25,0.75 L 4.5,11.25';
//   Top wing: back-top → nose → left fold crease.
const PLANE_B_D = 'M 17.25,0.75 L 4.5,11.25 L 0.75,1';
//   Bottom wing: nose → back-bottom → left fold crease.
const PLANE_C_D = 'M 0.75,1 L 4.5,11.25 L 17.25,0.75';
//   Spine crease: back-top → center → back-bottom.

// ── Cutout triangle (fades in over paper plane) ───────────────────────────────
// Derived from the inner notch in paper-plane-cutout.svg, scaled 24→18 (×0.75).
// Original vertices (24-space): (4.73,8.91), (9.78,5.65), (3.80,6.39)
const CUTOUT_D = 'M 3.5,6.7 L 7.3,4.2 L 2.85,4.8 Z';

// WAAPI keyframe values — CSS `d` property requires path() wrapper for cross-browser support
const p = (d: string) => `path('${d}')`;

const DURATION = 400;
const EASING = 'ease-in-out';

export const AnimatedEmailIcon = (props: { triggerAnimation?: boolean }) => {
  const clipId = createUniqueId();
  let bodyAEl!: SVGPathElement;
  let bodyBEl!: SVGPathElement;
  let flapEl!: SVGPathElement;
  let cutoutEl!: SVGPathElement;
  let prevTrigger = false;

  createEffect(() => {
    const trigger = !!props.triggerAnimation;
    if (trigger === prevTrigger) return;
    prevTrigger = trigger;

    const direction = (trigger ? 'normal' : 'reverse') as PlaybackDirection;
    const opts = {
      duration: DURATION,
      easing: EASING,
      fill: 'forwards' as FillMode,
      direction,
      delay: trigger ? 0 : DURATION,
    };

    // stroke-linejoin isn't interpolatable — switch it at the boundary where it looks best:
    // going forward (→ plane): round immediately so the join softens as the shape morphs.
    // going back (→ email): revert to miter only after the reverse animation completes.
    if (trigger) flapEl.setAttribute('stroke-linejoin', 'round');

    const cutoutAnim = cutoutEl.animate(
      trigger
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: DURATION,
        easing: EASING,
        fill: 'forwards' as FillMode,
        delay: trigger ? DURATION : 0,
      }
    );

    const anims = [
      bodyAEl.animate([{ d: p(BODY_A_D) }, { d: p(PLANE_A_D) }], opts),
      bodyBEl.animate([{ d: p(BODY_B_D) }, { d: p(PLANE_B_D) }], opts),
      flapEl.animate([{ d: p(FLAP_D) }, { d: p(PLANE_C_D) }], opts),
    ];

    Promise.all([...anims, cutoutAnim].map((a) => a.finished)).then(() => {
      [...anims, cutoutAnim].forEach((a) => {
        try {
          a.commitStyles();
          a.cancel();
        } catch (_) {}
      });
      if (!trigger) flapEl.setAttribute('stroke-linejoin', 'miter');
    });
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
      <title>Animated email icon</title>
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
