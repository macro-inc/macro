export const AnimatedFilterIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4.5 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-filter-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated filter icon</title>
      <style>{`
        @keyframes line-jiggle {
          0% {
            transform: rotate(0deg) translateY(0);
          }
          20% {
            transform: rotate(5deg) translateY(1px);
          }
          40% {
            transform: rotate(-4deg) translateY(0.5px);
          }
          60% {
            transform: rotate(3deg) translateY(0);
          }
          80% {
            transform: rotate(-2deg) translateY(0);
          }
          100% {
            transform: rotate(0deg) translateY(0);
          }
        }

        .animated-filter-icon .line-top {
          transform-origin: 9px 0.75px;
        }
        .animated-filter-icon .line-middle {
          transform-origin: 9px 4.5px;
        }
        .animated-filter-icon .line-bottom {
          transform-origin: 9px 8.25px;
        }

        .animated-filter-icon.animating .line-top {
          animation: line-jiggle 0.3s ease-in-out;
        }
        .animated-filter-icon.animating .line-middle {
          animation: line-jiggle 0.3s ease-in-out 0.1s;
        }
        .animated-filter-icon.animating .line-bottom {
          animation: line-jiggle 0.3s ease-in-out 0.2s;
        }
      `}</style>

      {/* Top line - widest */}
      <rect class="line-top" width="18" height="1.5" />
      {/* Middle line */}
      <rect class="line-middle" x="3" y="3.75" width="12" height="1.5" />
      {/* Bottom line - narrowest */}
      <rect class="line-bottom" x="6" y="7.5" width="6" height="1.5" />
    </svg>
  );
};
