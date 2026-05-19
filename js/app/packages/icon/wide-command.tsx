export const AnimatedCommandIcon = (props: { triggerAnimation?: boolean }) => {
  // ⌘ symbol from Asset 183.svg (15.05×15.05 viewBox, 1.5px stroke).
  // On hover: translucent bg appears + icon scales up with spring easing.
  // stroke-width is compensated (÷1.15) during animation so visual weight stays constant.

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-1.5 -1.5 18 18"
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
            transform-origin: 7.525px 7.525px;
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
        width="15.05"
        height="15.05"
        fill="currentColor"
        stroke="none"
      />

      <g class="command-group">
        <rect x="5.27" y="5.27" width="4.52" height="4.52" />
        <path d="M3.01.75C1.76.75.75,1.76.75,3.01s1.01,2.26,2.26,2.26h2.26v-2.26c0-1.25-1.01-2.26-2.26-2.26Z" />
        <path d="M14.3,3.01c0-1.25-1.01-2.26-2.26-2.26s-2.26,1.01-2.26,2.26v2.26h2.26c1.25,0,2.26-1.01,2.26-2.26Z" />
        <path d="M.75,12.04c0,1.25,1.01,2.26,2.26,2.26s2.26-1.01,2.26-2.26v-2.26h-2.26c-1.25,0-2.26,1.01-2.26,2.26Z" />
        <path d="M12.04,9.78h-2.26v2.26c0,1.25,1.01,2.26,2.26,2.26s2.26-1.01,2.26-2.26-1.01-2.26-2.26-2.26Z" />
      </g>
    </svg>
  );
};
