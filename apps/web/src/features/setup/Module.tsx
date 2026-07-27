import {
  createEffect,
  createUniqueId,
  For,
  onCleanup,
  onMount,
} from 'solid-js';
import './SetupGraphic.css';

/**
 * The dashed orbit rings — behind the body. They stay put during the click
 * burst while their dashes spin and they scale.
 */
export function ModuleRings() {
  return (
    <>
      <path
        class="ring-small"
        d="M367.2,58.7c0,19.4-16.8,41.9-37.5,50.2-20.7,8.3-37.5-.8-37.5-20.2s16.8-41.9,37.5-50.2c20.7-8.3,37.5.8,37.5,20.2Z"
      />
      <path
        class="ring-large"
        d="M409.5,71.5c0,30.9-26.7,66.6-59.6,79.8-32.9,13.2-59.6-1.2-59.6-32.2s26.7-66.6,59.6-79.8c32.9-13.2,59.6,1.2,59.6,32.2Z"
      />
    </>
  );
}

/**
 * The small vent arcs — part of the body mass. They thrust with the body
 * and flash accent during the click burst.
 */
export function ModuleVents() {
  return (
    <>
      <path class="vent" d="M326.9,143.4c1.9-7.8,5.1-15.7,9.3-23.2" />
      <path class="vent" d="M331.6,149.1c1.9-7.8,5.1-15.7,9.3-23.2" />
      <path class="vent" d="M337,155c1.9-7.8,5.1-15.7,9.3-23.2" />
    </>
  );
}

/**
 * The module's "body": the tile silhouette and the face ellipse the logo sits
 * on — the piece that thrusts forward (+D) during the click burst.
 */
export function ModuleBody() {
  return (
    <>
      <path
        class="panel"
        d="M396.2,227.8c8.7,1.1,18.7-.2,29.4-4.5,31.5-12.6,57.4-45.9,59.7-75.9h0s.3-5.7.3-5.7l-.3-5.5-.9-5.2-3.8-13.3-2.1-4.8-2.7-4.3-3.3-3.8-42.1-39.9-3.8-3.3-4.3-2.7-4.7-2.1-5.1-1.5-8.3-1.9-5.1-.8-5.4-.2-5.6.4-5.8,1-5.9,1.5-6,2.1-6,2.7-5.9,3.2-5.8,3.7-5.6,4.1-5.4,4.6-5.1,4.9-4.8,5.3-4.4,5.5-4,5.8-3.6,5.9-3.1,6-2.6,6.1-2,6.1-1.4,6-.9,5.9-.3,5.7.3,5.5.9,5.2,3.8,13.3,2.1,4.8,2.7,4.3,3.3,3.8,42.1,39.9,3.8,3.3,4.3,2.7,4.7,2.1,5.1,1.5,8.3,1.9,5.1.8"
      />
      <path
        class="hairline"
        d="M478.6,147.8c0,26.5-22.9,57.2-51.1,68.5-28.2,11.3-51.1-1.1-51.1-27.6s22.9-57.2,51.1-68.5,51.1,1.1,51.1,27.6Z"
      />
    </>
  );
}

/**
 * The full isometric tile (back + body), minus its logo.
 */
export function ModuleTile() {
  return (
    <>
      <ModuleRings />
      <ModuleBody />
      <ModuleVents />
    </>
  );
}

/**
 * Places a flat 24×24 brand logo onto a module's face, matching the isometric perspective.
 */
export const LOGO_FACE_TRANSFORM =
  'matrix(2.784 -1.113 0 2.619 394.09 150.228)';

/**
 * A brand mark to sit on a module face: one or more path `d` strings, filled
 * with `currentColor`, positioned by `transform` (defaults to the flat-logo
 * face transform via {@link LOGO_FACE_TRANSFORM}).
 */
export type ModuleLogo = { paths: string[]; transform?: string };

/**
 * A module's activity state, reflected in its logo:
 *  - `idle` — logo in ink.
 *  - `downloading` — logo pulses between ink and accent (pairs with the
 *    connector's travelling pulse).
 *  - `linked` — logo held solid accent.
 */
export type ModuleState = 'idle' | 'downloading' | 'linked';

const BOB_KEYFRAMES: Keyframe[] = [
  { transform: 'translateY(4px)', easing: 'ease-in-out' },
  { transform: 'translateY(-4px)', offset: 0.5, easing: 'ease-in-out' },
  { transform: 'translateY(4px)' },
];
const RING_BREATHE_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(0.97)', easing: 'ease-in-out' },
  { transform: 'scale(1.03)', offset: 0.5, easing: 'ease-in-out' },
  { transform: 'scale(0.97)' },
];
// One full dash period (dash 6 + gap 6), so the travel loops seamlessly.
const RING_DASH_KEYFRAMES: Keyframe[] = [
  { strokeDashoffset: '0' },
  { strokeDashoffset: '-12' },
];

// The module's long axis in local coords: the "depth" axis. The face is at the
// +D (down-right) end and the rings at the −D (up-left) end. On click the body
// thrusts +D while the rings stay put; the jet trail streaks −D behind it.
const POS_D = { x: 0.7256, y: 0.6881 };
const THRUST = 24;
const THRUST_X = (POS_D.x * THRUST).toFixed(1);
const THRUST_Y = (POS_D.y * THRUST).toFixed(1);

/**
 * Click burst timing. Asymmetric on purpose: a quick ramp to the peak, a brief
 * hold there, then a slow settle back. The keyframe offsets carve the ~1.6s
 * duration into roughly ramp / hold / settle; RAMP and SETTLE ease each phase.
 */
const ACCEL_MS = 2100;
const PEAK_IN = 0.17; // ramped to peak by here (~360ms)
const PEAK_OUT = 0.4; // held at peak until here (~480ms), then settles (~1.26s)
const RAMP = 'cubic-bezier(0.1, 0.75, 0.3, 1)'; // fast punch
const SETTLE = 'cubic-bezier(0.35, 0, 0.3, 1)'; // slow ease back

// The body thrusts forward (+D), holds, then eases back.
const ACCEL_BODY: Keyframe[] = [
  { transform: 'translate(0,0)', easing: RAMP },
  { transform: `translate(${THRUST_X}px,${THRUST_Y}px)`, offset: PEAK_IN },
  {
    transform: `translate(${THRUST_X}px,${THRUST_Y}px)`,
    offset: PEAK_OUT,
    easing: SETTLE,
  },
  { transform: 'translate(0,0)' },
];
// Rings stay put but change size — large grows, small shrinks — hold, settle.
// (No geometric rotation: the ellipses are in perspective; their dashes spin,
// via ACCEL_*_DASH.) Composited onto the ambient breathe, so start/end neutral.
const ACCEL_LARGE_RING: Keyframe[] = [
  { transform: 'scale(1)', easing: RAMP },
  { transform: 'scale(1.2)', offset: PEAK_IN },
  { transform: 'scale(1.2)', offset: PEAK_OUT, easing: SETTLE },
  { transform: 'scale(1)' },
];
const ACCEL_SMALL_RING: Keyframe[] = [
  { transform: 'scale(1)', easing: RAMP },
  { transform: 'scale(0.8)', offset: PEAK_IN },
  { transform: 'scale(0.8)', offset: PEAK_OUT, easing: SETTLE },
  { transform: 'scale(1)' },
];
// The dashes spin fast around each ring, opposite directions, throughout the
// burst. Sweeping a whole number of dash periods (12 = dash 6 + gap 6) lands
// neutral, so composited onto the ambient dash travel it leaves no seam.
const ACCEL_LARGE_DASH: Keyframe[] = [
  { strokeDashoffset: '0' },
  { strokeDashoffset: '-144' },
];
const ACCEL_SMALL_DASH: Keyframe[] = [
  { strokeDashoffset: '0' },
  { strokeDashoffset: '144' },
];
// The "jet trail": a rect laid along the −D axis via JET_TRAIL_TRANSFORM (local
// +x → −D), so its length runs backward from the module and its local y is the
// (perpendicular) width. Positioned so the opaque gradient end sits at the
// module and fades to transparent up-left.
const JET_TRAIL_TRANSFORM = 'translate(420 162) rotate(223.5)';
const JET_TRAIL_LENGTH = 230;
const JET_TRAIL_HALF = 15; // half-width of the thin (peak) jet trail

// Jet trail: starts wide and faint, focuses to a thin, bright streak at the peak
// (scaleY narrows it about its centerline), holds, then fades out. scaleY is
// on an inner group whose transform-origin is its center.
const ACCEL_JET_TRAIL: Keyframe[] = [
  { transform: 'scaleY(2.4)', opacity: 0, easing: RAMP },
  { transform: 'scaleY(1)', opacity: 0.9, offset: PEAK_IN },
  { transform: 'scaleY(1)', opacity: 0.9, offset: PEAK_OUT, easing: SETTLE },
  { transform: 'scaleY(1)', opacity: 0 },
];

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Resolve `--color-accent` to a concrete color (WAAPI can't interpolate a
 * `var(--…)` keyframe). The probe must resolve the var in the module's own
 * context: `--color-accent` is themed, so a probe outside the app's theme
 * scope (e.g. on document.body) picks up a different fallback value. Appending
 * an SVG probe inside `context` keeps it in both the themed and SVG cascade.
 */
const resolveAccent = (context: Element) => {
  const probe = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'g'
  ) as SVGGElement;
  probe.style.color = 'var(--color-accent)';
  context.appendChild(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  return accent;
};

/**
 * A single hovering module: the isometric tile with a brand logo on its face,
 * bobbing gently while its orbit rings breathe and their dashes travel.
 *
 * Renders as an embeddable `<g>` (drop it into any SVG whose root carries the
 * `setup-graphic` class for styling). Ambient motion is self-driven with WAAPI
 * so it survives a parent's DOM re-attach without restarting — a CSS animation
 * would visibly pop. Pass `phaseMs` (a negative offset) so several modules
 * don't move in unison.
 *
 * Clicking the module plays an "acceleration" burst: the body thrusts forward
 * (+D), the vents flash to accent, the large ring grows and its dashes spin
 * one way while the small ring shrinks and its dashes spin the other, and an
 * jet trail focuses in behind it — a quick ramp, a brief hold, then a slow
 * settle back.
 *
 * `state` reflects activity in the logo's color (see {@link ModuleState}); it
 * updates reactively, so it can be toggled at runtime.
 */
export function Module(props: {
  logo: ModuleLogo;
  /** Transform positioning the module (e.g. translate/scale). */
  place?: string;
  /** Phase offset in ms (negative) so modules bob out of sync. */
  phaseMs?: number;
  /** Whether to run the ambient bob/ring motion (default true). */
  animate?: boolean;
  /** Activity state reflected in the logo color (default 'idle'). */
  state?: ModuleState;
  class?: string;
}) {
  let root: SVGGElement | undefined;
  let logoGroup: SVGGElement | undefined;
  let ventsGroup: SVGGElement | undefined;
  const jetTrailGradientId = createUniqueId();
  const animations: Animation[] = [];
  let clickAnimations: Animation[] = [];
  onCleanup(() => {
    for (const animation of animations) animation.cancel();
    for (const animation of clickAnimations) animation.cancel();
  });

  // Drive color from `state`, reactively (toggle-able at runtime). The logo
  // and vents are `currentColor`, so a `color` on their group recolors them.
  // Both the linked hold and the downloading pulse use a live `var(--color-
  // accent)` (inline for linked, a CSS animation for downloading) rather than
  // a probed concrete color: the themed accent is applied after mount, so a
  // value baked at effect time would be the pre-theme fallback (green).
  createEffect(() => {
    const state = props.state ?? 'idle';
    if (!logoGroup || !root) return;
    logoGroup.classList.remove('logo-downloading');
    logoGroup.style.color = '';
    if (ventsGroup) ventsGroup.style.color = '';
    if (state === 'linked') {
      logoGroup.style.color = 'var(--color-accent)';
      if (ventsGroup) ventsGroup.style.color = 'var(--color-accent)';
    } else if (state === 'downloading' && !prefersReducedMotion()) {
      logoGroup.classList.add('logo-downloading');
    }
  });

  onMount(() => {
    if (!root || props.animate === false || prefersReducedMotion()) return;
    const delay = props.phaseMs ?? 0;
    animations.push(
      root.animate(BOB_KEYFRAMES, {
        duration: 4500,
        iterations: Number.POSITIVE_INFINITY,
        delay,
      })
    );
    for (const ring of root.querySelectorAll<SVGElement>(
      '.ring-small, .ring-large'
    )) {
      animations.push(
        ring.animate(RING_BREATHE_KEYFRAMES, {
          duration: 4500,
          iterations: Number.POSITIVE_INFINITY,
          delay,
        }),
        ring.animate(RING_DASH_KEYFRAMES, {
          duration: 3000,
          iterations: Number.POSITIVE_INFINITY,
          easing: 'linear',
          delay,
        })
      );
    }
  });

  // The click "acceleration" burst. Ring scale + dash composite onto the
  // ambient animations (composite: 'add') and start/end neutral, so no restart
  // pop; the body and jet trail have no ambient motion, so they just replace.
  const accelerate = () => {
    if (!root || prefersReducedMotion()) return;
    for (const animation of clickAnimations) animation.cancel();
    clickAnimations = [];
    const accent = resolveAccent(root);
    const dur = { duration: ACCEL_MS } as const;
    const add = { duration: ACCEL_MS, composite: 'add' as const };
    // Dashes spin fast then wind down (ease-out) over the whole burst.
    const spin = { ...add, easing: 'ease-out' };

    const body = root.querySelector<SVGElement>('.module-body');
    const large = root.querySelector<SVGElement>('.ring-large');
    const small = root.querySelector<SVGElement>('.ring-small');
    const jetTrail = root.querySelector<SVGElement>('.module-jet-trail-scale');
    if (body) clickAnimations.push(body.animate(ACCEL_BODY, dur));
    if (large) {
      clickAnimations.push(large.animate(ACCEL_LARGE_RING, add));
      clickAnimations.push(large.animate(ACCEL_LARGE_DASH, spin));
    }
    if (small) {
      clickAnimations.push(small.animate(ACCEL_SMALL_RING, add));
      clickAnimations.push(small.animate(ACCEL_SMALL_DASH, spin));
    }
    if (jetTrail) clickAnimations.push(jetTrail.animate(ACCEL_JET_TRAIL, dur));
    for (const vent of root.querySelectorAll<SVGElement>(
      '.module-vents path'
    )) {
      // Flash from the vent's current resting stroke (ink normally, but accent
      // in the linked state) so a linked module's vents don't jump to ink.
      const resting = getComputedStyle(vent).stroke;
      clickAnimations.push(
        vent.animate(
          [
            { stroke: resting, opacity: 0.4, easing: RAMP },
            { stroke: accent, opacity: 1, offset: PEAK_IN },
            { stroke: accent, opacity: 1, offset: PEAK_OUT, easing: SETTLE },
            { stroke: resting, opacity: 0.4 },
          ],
          dur
        )
      );
    }
  };

  return (
    <g
      ref={root}
      class={`module-bob ${props.class ?? ''}`}
      onClick={(event) => {
        // Don't also trigger a parent's click (e.g. the setup scene's slide).
        event.stopPropagation();
        accelerate();
      }}
    >
      <g class="module" transform={props.place}>
        <defs>
          <linearGradient
            id={jetTrailGradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={JET_TRAIL_LENGTH}
            y2="0"
          >
            <stop offset="0%" class="module-jet-trail-hot" />
            <stop offset="100%" class="module-jet-trail-cold" />
          </linearGradient>
        </defs>
        {/* Accent jet trail behind the module — hidden until the click burst. The
            inner group's width (scaleY) and opacity are what animate. */}
        <g class="module-jet-trail" transform={JET_TRAIL_TRANSFORM}>
          <g class="module-jet-trail-scale">
            <rect
              x="0"
              y={-JET_TRAIL_HALF}
              width={JET_TRAIL_LENGTH}
              height={JET_TRAIL_HALF * 2}
              fill={`url(#${jetTrailGradientId})`}
            />
          </g>
        </g>
        {/* Rings stay put behind; the body mass — card, face, logo, and the
            vents on top of it — thrusts forward on click. */}
        <ModuleRings />
        <g class="module-body">
          <ModuleBody />
          <g
            ref={logoGroup}
            class="module-logo"
            transform={props.logo.transform ?? LOGO_FACE_TRANSFORM}
          >
            <For each={props.logo.paths}>{(d) => <path d={d} />}</For>
          </g>
          <g ref={ventsGroup} class="module-vents">
            <ModuleVents />
          </g>
        </g>
      </g>
    </g>
  );
}
