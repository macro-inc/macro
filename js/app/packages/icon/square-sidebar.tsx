import { createUniqueId } from 'solid-js';

export const AnimatedSquareSidebarIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const notchMaskId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-1.5 -1.5 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-square-sidebar-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated square sidebar icon</title>*/}
      <defs>
        {/* Mask to cut out corner notches */}
        <mask id={notchMaskId} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-10" width="100" height="100" fill="white" />
          {/* Top-left notch */}
          <rect fill="black" x="-0.5" y="-0.5" width="2" height="2" />
          {/* Bottom-right notch */}
          <rect fill="black" x="13.5" y="13.5" width="2" height="2" />
        </mask>
      </defs>

      <style>{`
        @keyframes square-sidebar-slide {
          0% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          50% { transform: translateX(-3px); }
          75% { transform: translateX(0); }
          100% { transform: translateX(0); }
        }

        .animated-square-sidebar-icon.animating .sidebar-divider {
          animation: square-sidebar-slide 0.6s ease-in-out;
        }
      `}</style>

      {/* Outer frame with corner notches */}
      <rect
        x="0.75"
        y="0.75"
        width="13.5"
        height="13.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        mask={`url(#${notchMaskId})`}
      />

      {/* Vertical divider — slides left to the frame's interior edge, then back */}
      <rect
        class="sidebar-divider"
        x="4.5"
        y="0.75"
        width="1.5"
        height="13.5"
      />
    </svg>
  );
};
