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
          .left-bar, .right-bar {
            /* Butt caps: a round cap centered on the hinge would balloon into
               an ellipse under the animating scaleY and poke above the back rim. */
            stroke-linecap: butt;
          }
          .left-bar {
            transform-origin: 4.5px 0.75px;
            transition: transform 0.2s ease;
          }
          .right-bar {
            transform-origin: 13.5px 0.75px;
            transition: transform 0.2s ease;
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
          /* Flaps swing open AND extend — the tip drops with the drawer front.
             Stretched from the fixed hinge via scaleY (not 'd' morphing, which
             doesn't animate in Safari/WebKit — see wide-channel.tsx). */
          .left-bar, .right-bar {
            transform: scaleY(1.6667);
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
      <line x1="4.5" y1="0.75" x2="13.5" y2="0.75" />

      {/* Walls + rounded bottom */}
      <path
        class="drawer-body"
        d="M0.75 5.25L0.75 9.9375A1.5 1.5 0 0 0 2.0625 11.25L15.9375 11.25A1.5 1.5 0 0 0 17.25 9.9375L17.25 5.25"
      />

      {/* Tray shelf with central slot */}
      <path
        class="tray"
        d="M0.75 5.25L6.92 5.25L7.67 6.48L10.33 6.48L11.08 5.25L17.25 5.25"
      />

      {/* Flaps — stretched via scaleY from their fixed hinge point (see CSS above) */}
      <path class="right-bar" d="M13.5 0.75L17.25 5.25" />
      <path class="left-bar" d="M4.5 0.75L0.75 5.25" />
    </svg>
  );
};
