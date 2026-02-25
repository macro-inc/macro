export const AnimatedNoiseIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4 24 24"
      fill="currentColor"
      stroke="none"
      overflow="visible"
      xmlns="http://www.w3.org/2000/svg"
      class={`animated-noise-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated noise icon</title>
      <style>{`
        @keyframes grow-shrink {
          0% {
            transform: scaleY(1);
          }
          40% {
            transform: scaleY(.4);
          }
          80% {
            transform: scaleY(.4);
          }
          100% {
            transform: scaleY(1);
          }
        }
        .animated-noise-icon.animating {
          .bars {
            opacity: 1;
          }
          .line {
            opacity: 0;
          }
          .bar-1 {
            transform-origin: 3px 8px;
            animation: grow-shrink 0.4s ease-in-out forwards;
          }
          .bar-2 {
            transform-origin: 7px 8px;
            animation: grow-shrink 0.4s ease-in-out .2s forwards;
          }
          .bar-3 {
            transform-origin: 11px 8px;
            animation: grow-shrink 0.4s ease-in-out .1s forwards;
          }
          .bar-4 {
            transform-origin: 15px 8px;
            animation: grow-shrink 0.4s ease-in-out .1s forwards;
          }
          .bar-5 {
            transform-origin: 19px 8px;
            animation: grow-shrink 0.4s ease-in-out forwards;
          }
          .bar-6 {
            transform-origin: 23px 8px;
            animation: grow-shrink 0.4s ease-in-out .2s forwards;
          }
        }
      `}</style>
      <g class="bars">
        <rect class="bar-1" x="2" y="6" width="2" height="4" />
        <rect class="bar-2" x="6" y="3.25" width="2" height="9.5" />
        <rect class="bar-3" x="10" y="0" width="2" height="16" />
        <rect class="bar-4" x="14" y="5" width="2" height="6" />
        <rect class="bar-5" x="18" y="1.5" width="2" height="13" />
        <rect class="bar-6" x="22" y="7" width="2" height="2" />
      </g>
    </svg>
  );
};
