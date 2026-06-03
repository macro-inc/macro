import { createUniqueId } from 'solid-js';

export const AnimatedDiagramIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();
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
      overflow="visible"
      class={`animated-diagram-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated diagram icon</title>*/}
      <style>{`
        .animated-diagram-icon {
          .left-node, .right-node, .center-node, .left-arm, .right-arm {
            transition: transform 0.4s ease;
          }
          /* scale from the square-end so the arms stretch/shrink to the diamond
             without their caps poking into the square nodes */
          .left-arm { transform-origin: 2.625px 4.6875px; }
          .right-arm { transform-origin: 15.375px 4.6875px; }
          #${maskId} .cover-right {
            transition: transform 0.4s ease;
          }
        }
        .animated-diagram-icon.animating {
          .right-node {
            transform: translate(0, 9.5px);
          }
          .center-node {
            transform: translate(0, -0.75px);
          }
          .left-arm {
            transform: scaleY(0.78);
          }
          .right-arm {
            transform: translate(0, 2.65px) scaleY(0.8);
          }
          /* footprint slides with the right node so the square covers the arm */
          #${maskId} .cover-right {
            transform: translate(0, 9.5px);
          }
        }
      `}</style>

      {/* The footprint sits on the right node's stroke centerline (its rect path)
          and slides down in sync with it, so that square appears to cover the arm
          behind it. Aligning to the centerline keeps the mask seam hidden under
          the node's own stroke on every edge. */}
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <rect x="-2" y="-3" width="22" height="22" fill="white" />
        <rect
          class="cover-right"
          fill="black"
          x="13.3125"
          y="0.5625"
          width="4.125"
          height="4.125"
        />
      </mask>

      {/* Connectors + diamond — masked so the square nodes appear to cover them */}
      <g mask={`url(#${maskId})`}>
        {/* Center diamond node + horizontal connectors */}
        <g class="center-node">
          <rect
            x="6.475"
            y="5.615"
            width="4.95"
            height="4.95"
            rx="1"
            transform="rotate(45 8.95 8.09)"
          />
          <line x1="5.45" y1="8.09" x2="2.625" y2="8.09" />
          <line x1="12.45" y1="8.09" x2="15.375" y2="8.09" />
        </g>
        {/* Vertical connector arms */}
        <line class="left-arm" x1="2.625" y1="4.6875" x2="2.625" y2="8.09" />
        <line class="right-arm" x1="15.375" y1="4.6875" x2="15.375" y2="8.09" />
      </g>

      {/* Square nodes (drawn on top) */}
      <rect
        class="right-node"
        x="13.3125"
        y="0.5625"
        width="4.125"
        height="4.125"
        rx="1"
      />
      <rect
        class="left-node"
        x="0.5625"
        y="0.5625"
        width="4.125"
        height="4.125"
        rx="1"
      />
    </svg>
  );
};
