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
      stroke-width="1.5"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-company-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated company icon</title>*/}
      <style>{`
        .animated-company-icon {
          .building-center, #${maskId} .mask-center { transform-origin: 9px 6px; }
          /* Origin at each L's bottom point so scaling grows them upward only */
          .building-left { transform-origin: 0.75px 10.5px; }
          .building-right { transform-origin: 17.25px 10.5px; }
          .building-center, .building-left, .building-right, .ground, #${maskId} .mask-center {
            transition: transform 0.4s ease;
          }
          /* Counter-scale the outline so it reads ~1.5px at any zoom */
          .building-outline {
            stroke-width: 1.5px;
            transition: stroke-width 0.4s ease;
          }
        }
        .animated-company-icon.animating {
          .building-center, #${maskId} .mask-center {
            transform: scale(1.5);
          }
          /* 1.5 * (2/3) = 1 -> rendered stroke stays ~1.5px under scale(1.5) */
          .building-outline {
            stroke-width: 1px;
          }
          /* Keep the ground touching the door/L bottoms: door bottom 10.5 ->
             12.75 under scale(1.5); ground top edge meets it at centerline 13.5
             (translateY 2.25). Side L's translate down by the same amount. */
          .ground {
            transform: translateY(2.25px);
          }
          .building-left {
            transform: translate(4px, 2.25px) scale(1.2);
          }
          .building-right {
            transform: translate(-4px, 2.25px) scale(1.2);
          }
        }
      `}</style>

      <defs>
        {/* Hide the side buildings wherever the (growing) middle building sits */}
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-40" width="100" height="140" fill="white" />
          <rect
            class="mask-center"
            x="4"
            y="0.5"
            width="10"
            height="11"
            fill="black"
          />
        </mask>
      </defs>

      {/* Ground */}
      <path class="ground" d="M0 11.25H18" stroke-miterlimit="10" />

      {/* Side buildings - masked so they vanish behind the middle building */}
      <g mask={`url(#${maskId})`}>
        <path
          class="building-right"
          d="M17.25 10.5V6H16"
          stroke-linejoin="round"
        />
        <path
          class="building-left"
          d="M0.75 10.5V3.5H2"
          stroke-linejoin="round"
        />
      </g>

      {/* Middle building (on top) - outline + windows + door */}
      <g class="building-center">
        <path
          class="building-outline"
          d="M4.25 11.25V0.75H13.75V11.25"
          stroke-linejoin="round"
        />
        <path
          d="M8.22998 3H6.72998V4.5H8.22998V3Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M11.23 3H9.72998V4.5H11.23V3Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M8.22998 6H6.72998V7.5H8.22998V6Z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="M11.23 6H9.72998V7.5H11.23V6Z"
          fill="currentColor"
          stroke="none"
        />
        <path d="M9.75 9H8.25V10.5H9.75V9Z" fill="currentColor" stroke="none" />
      </g>
    </svg>
  );
};
