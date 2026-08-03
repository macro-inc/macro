export const AnimatedHomeIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-home-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-home-icon {
          .door, .window {
            opacity: 0;
            transition: opacity 0.2s ease;
          }
          .door {
            transform-box: fill-box;
            transform-origin: left bottom;
            transform: scaleX(0);
            transition: transform 0.3s ease, opacity 0.15s ease;
          }
          .window {
            transform-box: fill-box;
            transform-origin: center;
            transform: scale(0);
            transition: transform 0.2s ease, opacity 0.15s ease;
          }
        }
        .animated-home-icon.animating {
          .door {
            opacity: 1;
            transform: scaleX(1);
          }
          .window {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>

      {/* Asset 286 is reduced to 75% here, giving it the sidebar's effective 1.125px stroke. */}
      <g transform="translate(2.25 -1.03125) scale(.75)">
        <g class="house">
          <path d="M.75 9C.75 8.8.83 8.6.98 8.45L8.45.98C8.75.68 9.25.68 9.55.98L17.02 8.45C17.17 8.6 17.25 8.8 17.25 9V18H11.25V12H6.75V18H.75V9Z" />
          <rect
            class="door"
            x="6.75"
            y="12"
            width="4.5"
            height="6.75"
            fill="currentColor"
            stroke="none"
          />
          <rect
            class="window"
            x="7.31"
            y="5.87"
            width="3.38"
            height="3.38"
            rx="1"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>
    </svg>
  );
};
