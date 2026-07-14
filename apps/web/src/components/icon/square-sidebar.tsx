export const AnimatedSquareSidebarIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-1.5 -1.5 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-square-sidebar-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated square sidebar icon</title>*/}
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

      {/* Window frame */}
      <rect x="0.5625" y="0.5625" width="13.875" height="13.875" rx="1.5" />

      {/* Vertical divider — slides left then back to toggle the sidebar */}
      <line
        class="sidebar-divider"
        x1="5.25"
        y1="0.5625"
        x2="5.25"
        y2="14.4375"
      />
    </svg>
  );
};
