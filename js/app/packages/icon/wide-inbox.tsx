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
      viewBox="2.5 -3 18 18"
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
          .right-bar {
            transition: d 0.2s ease;
            d: path("M16.8 0.75L19.76 6.15");
          }
          .left-bar {
            transition: d 0.2s ease;
            d: path("M6.2 0.75L3.22 6.19");
          }
          .envelope {
            transform-origin: center;
            transition: transform 0.4s ease;
          }
          .tray, .right-line, .left-bottom-lines, #${maskId} .moving-mask-parts {
            transition: transform 0.2s ease;
          }
        }
        .animated-inbox-icon.animating {
          .envelope {
            transform: translate(0px, -3.5px) rotate(5deg);
          }
          .tray, .right-line, .left-bottom-lines, #${maskId} .moving-mask-parts {
            transform: translate(0, 3px);
          }
          /* flaps swing open AND extend — the tip drops with the drawer front.
             Animating 'd' (geometry) instead of scaleX avoids warping the round caps. */
          .left-bar {
            d: path("M6.2 0.75L3.22 9.19");
          }
          .right-bar {
            d: path("M16.8 0.75L19.76 9.15");
          }
        }
      `}</style>

      {/* Only the card is masked — it's hidden while inside the drawer and revealed
          as it rises above the shelf. The drawer outline is drawn unmasked. */}
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="-2"
        y="-5"
        width="26"
        height="32"
      >
        <rect x="-2" y="-5" width="26" height="32" fill="white" />
        <rect class="moving-mask-parts" fill="black" x="-2" y="6" width="26" height="26" />
      </mask>

      <g mask={`url(#${maskId})`}>
        <g class="envelope">
          <rect x="7.48" y="7.25" width="8" height="6.5" rx="0.75" />
          <rect x="12" y="9.5" width="1.5" height="1.5" fill="currentColor" stroke="none" />
        </g>
      </g>

      {/* Drawer (unmasked) */}
      {/* Top bar (back rim) */}
      <line x1="6.49" y1="0.75" x2="16.67" y2="0.75" />

      {/* Right wall */}
      <line class="right-line" x1="19.73" y1="5.8" x2="19.73" y2="11.25" />

      {/* Left wall + bottom */}
      <path class="left-bottom-lines" d="M3.23 5.8L3.23 11.25L19.73 11.25" />

      {/* Tray shelf with central slot */}
      <path
        class="tray"
        d="M3.23 6L8.98 6L9.73 7.23L13.23 7.23L13.98 6L19.73 6"
      />

      {/* Flaps — animated via 'd' so the tip drops to the dropped drawer front
          while stroke-width (and the round caps) stay constant */}
      <path class="right-bar" d="M16.8 0.75L19.76 6.15" />
      <path class="left-bar" d="M6.2 0.75L3.22 6.19" />
    </svg>
  );
};
