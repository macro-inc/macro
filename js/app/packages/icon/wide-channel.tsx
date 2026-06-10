import { createEffect, createUniqueId } from 'solid-js';

// One-shot "zip in" animation. On the rising edge of triggerAnimation the whole hash
// disappears (each line jumps off-screen, clipped) and the 4 pieces zip back in along
// their own axes (4 distinct directions) and settle. Built on `transform` (not `d`
// morphing), so unlike the old version it animates in Safari/WebKit too (incl. the macOS
// Tauri WKWebView).
//
// Each line zips in along its own axis (opposite within each pair, so all 4 differ):
//   channel-h-top    in from the left          (+X axis)
//   channel-h-bottom in from the right         (-X axis)
//   channel-v-left   in from the bottom-left   ((5,-15) axis)
//   channel-v-right  in from the top-right     ((5,-15) axis)

const DURATION = 500;

// A short beat with the hash gone before the pieces zip in.
const HOLD = 0.15;

// Zip-in easing: fast in then a slight overshoot past rest before settling (easeOutBack).
const EASE_ENTER = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

// Off-screen start offsets (user units) — each line begins fully outside the 24x24 clip
// box along its own axis, then slides to rest at translate(0).
const VECTORS = {
  hTop: [-26, 0],
  hBottom: [26, 0],
  vLeft: [-8, 24],
  vRight: [8, -24],
} as const;

export const AnimatedChannelIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  let hTopEl!: SVGPathElement;
  let hBottomEl!: SVGPathElement;
  let vLeftEl!: SVGPathElement;
  let vRightEl!: SVGPathElement;
  let prevTrigger = false;
  let anims: Animation[] = [];

  // Unique clipPath id so multiple instances on a page don't collide.
  const clipId = `channel-clip-${createUniqueId()}`;

  const opts = { duration: DURATION, fill: 'none' as FillMode, iterations: 1 };

  const whisk = (el: SVGPathElement, [dx, dy]: readonly [number, number]) =>
    el.animate(
      [
        // hold off-screen for a beat (clipped) so the hash reads as "gone"...
        {
          transform: `translate(${dx}px,${dy}px)`,
          offset: 0,
          easing: 'linear',
        },
        {
          transform: `translate(${dx}px,${dy}px)`,
          offset: HOLD,
          easing: EASE_ENTER,
        },
        // ...then zip in along the axis and settle
        { transform: 'translate(0px,0px)', offset: 1 },
      ],
      opts
    );

  createEffect(() => {
    const trigger = !!props.triggerAnimation;
    if (trigger === prevTrigger) return;
    prevTrigger = trigger;
    // Only act on the rising edge — the cycle always runs to completion on its own,
    // independent of how long the caller holds the prop true.
    if (!trigger) return;

    // Restart cleanly if a previous cycle is still in flight.
    for (const a of anims) {
      try {
        a.cancel();
      } catch (_) {}
    }
    anims = [
      whisk(hTopEl, VECTORS.hTop),
      whisk(hBottomEl, VECTORS.hBottom),
      whisk(vLeftEl, VECTORS.vLeft),
      whisk(vRightEl, VECTORS.vRight),
    ];
  });

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="hidden"
      class={`animated-channel-icon ${props.class ?? ''}`}
    >
      {/*<title>Channel icon</title>*/}
      <clipPath id={clipId}>
        <rect x="0" y="-4" width="24" height="24" />
      </clipPath>
      <g clip-path={`url(#${clipId})`}>
        {/* Horizontals shortened ~1u on the edge-touching end so the round caps stay
            inside the clip box at rest (M2 5H24 -> H23, M0 11H22 -> M1). */}
        <path ref={hTopEl} class="channel-h channel-h-top" d="M2 5H23" />
        <path ref={hBottomEl} class="channel-h channel-h-bottom" d="M1 11H22" />
        <path
          ref={vLeftEl}
          class="channel-v channel-v-left"
          d="M6.5 15.5L11.5 0.5"
        />
        <path
          ref={vRightEl}
          class="channel-v channel-v-right"
          d="M12.5 15.5L17.5 0.5"
        />
      </g>
    </svg>
  );
};
