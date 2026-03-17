export const AnimatedCommandIcon = (props: { triggerAnimation?: boolean }) => {
  // ⌘ symbol from Asset 182.svg (18×18 viewBox, 1.5px stroke).
  // On hover: translucent bg appears + icon scales up with spring easing.
  // stroke-width is compensated (÷1.2) during animation so visual weight stays constant.

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-miterlimit="10"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-command-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated command icon</title>*/}
      <style>{`
        .animated-command-icon {
          .bg-fill { opacity: 0; transition: opacity 0.3s ease; }
          .command-group {
            transform-origin: 9px 9px;
            transition: transform 0.3s ease, stroke-width 0.3s ease;
          }
        }
        .animated-command-icon.animating {
          .bg-fill { opacity: 0.1; transition: opacity 0.4s ease; }
          .command-group {
            transform: scale(1.15);
            stroke-width: 1.3;
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
                        stroke-width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
        }
      `}</style>

      <rect
        class="bg-fill"
        x="0"
        y="0"
        width="18"
        height="18"
        fill="currentColor"
        stroke="none"
      />

      <g class="command-group">
        <rect x="6.25" y="6.25" width="5.5" height="5.5" />
        <path d="M3.5.75C1.98.75.75,1.98.75,3.5s1.23,2.75,2.75,2.75h2.75v-2.75c0-1.52-1.23-2.75-2.75-2.75Z" />
        <path d="M17.25,3.5c0-1.52-1.23-2.75-2.75-2.75s-2.75,1.23-2.75,2.75v2.75h2.75c1.52,0,2.75-1.23,2.75-2.75Z" />
        <path d="M.75,14.5c0,1.52,1.23,2.75,2.75,2.75s2.75-1.23,2.75-2.75v-2.75h-2.75c-1.52,0-2.75,1.23-2.75,2.75Z" />
        <path d="M14.5,11.75h-2.75v2.75c0,1.52,1.23,2.75,2.75,2.75s2.75-1.23,2.75-2.75-1.23-2.75-2.75-2.75Z" />
      </g>
    </svg>
  );
};
