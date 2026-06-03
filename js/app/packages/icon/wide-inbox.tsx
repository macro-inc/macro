import { createUniqueId } from 'solid-js';

export const AnimatedInboxIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-inbox-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated inbox icon</title>*/}
      <style>{`
        .animated-inbox-icon {
          .left-bar {
            transition: d 0.2s ease;
            d: path("M4.5 0.5625L0.5625 5.25");
          }
          .right-bar {
            transition: d 0.2s ease;
            d: path("M13.5 0.5625L17.4375 5.25");
          }
          .envelope {
            transform-origin: center;
            transition: transform 0.4s ease;
          }
          .drawer-body, .tray, #${maskId} .moving-mask-parts {
            transition: transform 0.2s ease;
          }
        }
        .animated-inbox-icon.animating {
          .envelope {
            transform: translate(0px, -3.5px) rotate(5deg);
          }
          .drawer-body, .tray, #${maskId} .moving-mask-parts {
            transform: translate(0, 3px);
          }
          /* flaps swing open AND extend — the tip drops with the drawer front.
             Animating 'd' (geometry) instead of scaleX avoids warping the round caps. */
          .left-bar {
            d: path("M4.5 0.5625L0.5625 8.25");
          }
          .right-bar {
            d: path("M13.5 0.5625L17.4375 8.25");
          }
        }
      `}</style>

      {/* Only the card is masked — it's hidden while inside the drawer and revealed
          as it rises above the shelf. The drawer outline is drawn unmasked. */}
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="-2"
        y="-6"
        width="22"
        height="30"
      >
        <rect x="-2" y="-6" width="22" height="30" fill="white" />
        <rect
          class="moving-mask-parts"
          fill="black"
          x="-2"
          y="5.25"
          width="22"
          height="24"
        />
      </mask>

      <g mask={`url(#${maskId})`}>
        <g class="envelope">
          <rect x="5" y="6.5" width="8" height="6.5" rx="0.75" />
          <rect
            x="9.52"
            y="8.75"
            width="1.5"
            height="1.5"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>

      {/* Drawer (unmasked) */}
      {/* Back rim */}
      <line x1="4.5" y1="0.5625" x2="13.5" y2="0.5625" />

      {/* Walls + rounded bottom */}
      <path
        class="drawer-body"
        d="M0.5625 5.25L0.5625 9.9375A1.5 1.5 0 0 0 2.0625 11.4375L15.9375 11.4375A1.5 1.5 0 0 0 17.4375 9.9375L17.4375 5.25"
      />

      {/* Tray shelf with central slot */}
      <path
        class="tray"
        d="M0.5625 5.25L6.92 5.25L7.67 6.48L10.33 6.48L11.08 5.25L17.4375 5.25"
      />

      {/* Flaps — animated via 'd' so the tip drops to the dropped drawer front
          while stroke-width (and the round caps) stay constant */}
      <path class="right-bar" d="M13.5 0.5625L17.4375 5.25" />
      <path class="left-bar" d="M4.5 0.5625L0.5625 5.25" />
    </svg>
  );
};
