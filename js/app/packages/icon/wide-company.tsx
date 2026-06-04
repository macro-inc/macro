import { createUniqueId } from 'solid-js';

export const AnimatedCompanyIcon = (props: {
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
      class={`animated-company-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated company icon</title>*/}
      <style>{`
        .animated-company-icon {
          .building-center, #${maskId} .mask-center { transform-origin: 9px 6px; }
          /* Origin at each L's bottom point so scaling grows them upward only */
          .building-left { transform-origin: 0.5625px 10.875px; }
          .building-right { transform-origin: 17.4375px 10.875px; }
          .building-center, .building-left, .building-right, .ground, #${maskId} .mask-center {
            transition: transform 0.4s ease;
          }
          /* Counter-scale the outline so it reads ~1.125px at any zoom */
          .building-outline {
            stroke-width: 1.125px;
            transition: stroke-width 0.4s ease;
          }
        }
        .animated-company-icon.animating {
          .building-center, #${maskId} .mask-center {
            transform: scale(1.5);
          }
          /* 0.75 * 1.5 = 1.125 -> rendered stroke stays ~1.125px under scale(1.5) */
          .building-outline {
            stroke-width: 0.75px;
          }
          /* Keep the ground touching the door/L bottoms: door bottom 11.4375 ->
             14.15625 under scale(1.5); ground center moves to meet it
             (translateY 2.71875). Side L's translate down by the same amount. */
          .ground {
            transform: translateY(2.71875px);
          }
          .building-left {
            transform: translate(4px, 2.71875px) scale(1.2);
          }
          .building-right {
            transform: translate(-4px, 2.71875px) scale(1.2);
          }
        }
      `}</style>

      <defs>
        {/* Hide the side buildings wherever the (growing) middle building sits */}
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-40" width="100" height="140" fill="white" />
          <rect
            class="mask-center"
            x="3.625"
            y="0.125"
            width="10.75"
            height="11.75"
            fill="black"
          />
        </mask>
      </defs>

      {/* Ground */}
      <path class="ground" d="M0.5625 11.4375H17.4375" />

      {/* Side buildings - masked so they vanish behind the middle building */}
      <g mask={`url(#${maskId})`}>
        <path class="building-right" d="M17.4375 10.875V6H16" />
        <path class="building-left" d="M0.5625 10.875V3.5H2" />
      </g>

      {/* Middle building (on top) - outline + windows + door */}
      <g class="building-center">
        <path class="building-outline" d="M4.25 11.4375V0.5625H13.75V11.4375" />
        <rect
          x="6.73"
          y="3"
          width="1.5"
          height="1.5"
          rx="0.3"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="9.73"
          y="3"
          width="1.5"
          height="1.5"
          rx="0.3"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="6.73"
          y="6"
          width="1.5"
          height="1.5"
          rx="0.3"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="9.73"
          y="6"
          width="1.5"
          height="1.5"
          rx="0.3"
          fill="currentColor"
          stroke="none"
        />
        <rect
          x="8.25"
          y="9"
          width="1.5"
          height="2.4375"
          rx="0.3"
          fill="currentColor"
          stroke="none"
        />
      </g>
    </svg>
  );
};
