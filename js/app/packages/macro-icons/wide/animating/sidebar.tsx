import { createUniqueId } from 'solid-js';

export const AnimatedSidebarIcon = (props: { triggerAnimation?: boolean }) => {
  const clipId = createUniqueId();
  const notchMaskId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-sidebar-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated sidebar icon</title>*/}
      <defs>
        {/* Clip to frame interior */}
        <clipPath id={clipId}>
          <rect x="1.5" y="1.5" width="15" height="9" />
        </clipPath>

        {/* Mask to cut out corner notches */}
        <mask id={notchMaskId} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-10" width="100" height="100" fill="white" />
          {/* Top-left notch */}
          <rect fill="black" x="-0.5" y="-0.5" width="2" height="2" />
          {/* Bottom-right notch */}
          <rect fill="black" x="16.5" y="10.5" width="2" height="2" />
        </mask>
      </defs>

      <style>{`
        @keyframes sidebar-slide {
          0% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-4.5px);
          }
          50% {
            transform: translateX(-4.5px);
          }
          75% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(0);
          }
        }

        .animated-sidebar-icon.animating .sidebar-content {
          animation: sidebar-slide 0.6s ease-in-out;
        }
      `}</style>

      {/* Outer frame with corner notches */}
      <rect
        x="0.75"
        y="0.75"
        width="16.5"
        height="10.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        mask={`url(#${notchMaskId})`}
      />

      {/* Clip wrapper stays stationary, content inside slides */}
      <g clip-path={`url(#${clipId})`}>
        <g class="sidebar-content">
          {/* Vertical divider */}
          <rect x="6" y="0.75" width="1.5" height="10.5" />
          {/* Content lines */}
          <rect x="2.5" y="2.5" width="2.5" height="1" />
          <rect x="2.5" y="4.5" width="2.5" height="1" />
        </g>
      </g>
    </svg>
  );
};
