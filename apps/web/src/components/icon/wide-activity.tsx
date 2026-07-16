/**
 * Activity (pulse/EKG) icon. On trigger the pulse line redraws itself
 * left-to-right, like a live heartbeat trace.
 */
export const AnimatedActivityIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3.75 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-activity-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-activity-icon .pulse {
          stroke-dasharray: 29;
          stroke-dashoffset: 0;
        }
        .animated-activity-icon.animating .pulse {
          animation: activity-icon-draw 0.5s ease-out;
        }
        @keyframes activity-icon-draw {
          from {
            stroke-dashoffset: 29;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
      <polyline
        class="pulse"
        points="0.75,5.25 4.5,5.25 6.75,0.75 10.5,9.75 12.75,5.25 17.25,5.25"
      />
    </svg>
  );
};
