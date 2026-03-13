export const AnimatedPlusIcon = (props: { triggerAnimation?: boolean }) => {
  // Solid plus (Asset 170) switches to pixelated plus (Asset 171) during animation
  // After 0.4s, switches back to solid. Tinker with the pixelated version's animation!

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-plus-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated plus icon</title>*/}
      <style>{`
        @keyframes solid-fade {
          0% { opacity: 1; }
          5% { opacity: 0; }
          95% { opacity: 0; }
          100% { opacity: 1; }
        }

        @keyframes pixelated-fade {
          0% { opacity: 0; }
          5% { opacity: 1; }
          95% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes pixel-left-move {
          0% { transform: translate(0, 0); }
          40% { transform: translate(-.5px, -1px); }
          70%, 100% { transform: translate(0, 0); }
        }

        @keyframes pixel-top-move {
          0%, 10% { transform: translate(0, 0); }
          50% { transform: translate(1px, -.5px); }
          80%, 100% { transform: translate(0, 0); }
        }

        @keyframes pixel-right-move {
          0%, 20% { transform: translate(0, 0); }
          60% { transform: translate(.5px, 1px); }
          90%, 100% { transform: translate(0, 0); }
        }

        @keyframes pixel-bottom-move {
          0%, 30% { transform: translate(0, 0); }
          70% { transform: translate(-1px, .5px); }
          100% { transform: translate(0, 0); }
        }

        @keyframes left-arm-extension-move {
          0% { transform: translate(0, 0); }
          40% { transform: translate(-1px, 0); }
          100% { transform: translate(0, 0); }
        }

        @keyframes right-arm-extension-move {
          0%, 20% { transform: translate(0, 0); }
          60% { transform: translate(1px, 0); }
          80%, 100% { transform: translate(0, 0); }
        }

        @keyframes bottom-arm-extension-move {
          0%, 30% { transform: translate(0, 0); }
          70% { transform: translate(0, 1px); }
          90%, 100% { transform: translate(0, 0); }
        }

        .animated-plus-icon {
          .solid-plus { opacity: 1; }
          .pixelated-plus { opacity: 0; }

          &.animating {
            .solid-plus { animation: solid-fade 0.6s ease-in-out forwards; }
            .pixelated-plus { animation: pixelated-fade 0.6s ease-in-out forwards; }
            .pixel-left { animation: pixel-left-move 0.6s ease-in-out forwards; }
            .pixel-top { animation: pixel-top-move 0.6s ease-in-out forwards; }
            .pixel-right { animation: pixel-right-move 0.6s ease-in-out forwards; }
            .pixel-bottom { animation: pixel-bottom-move 0.6s ease-in-out forwards; }
            .left-arm-extension { animation: left-arm-extension-move 0.6s ease-in-out forwards; }
            .right-arm-extension { animation: right-arm-extension-move 0.6s ease-in-out forwards; }
            .bottom-arm-extension { animation: bottom-arm-extension-move 0.6s ease-in-out forwards; }
          }
        }
      `}</style>

      {/* Solid plus sign (from Asset 170.svg) */}
      <g class="solid-plus">
        <polygon points="18 5.25 9.75 5.25 9.75 0 8.25 0 8.25 5.25 0 5.25 0 6.75 8.25 6.75 8.25 12 9.75 12 9.75 6.75 18 6.75 18 5.25" />
      </g>

      {/* Pixelated plus sign (from Asset 171.svg - transforms resolved to x/y/w/h) */}
      <g class="pixelated-plus">
        {/* Main vertical bar */}
        <rect x="8.25" y="1.5" width="1.5" height="7.5" />
        {/* Main horizontal bar */}
        <rect x="6.75" y="5.25" width="7.5" height="1.5" />
        {/* Right arm extension */}
        <rect
          class="right-arm-extension"
          x="15.75"
          y="5.25"
          width="2.25"
          height="1.5"
        />
        {/* Bottom arm extension */}
        <rect
          class="bottom-arm-extension"
          x="8.25"
          y="10.5"
          width="1.5"
          height="1.5"
        />
        {/* Left arm extension */}
        <rect
          class="left-arm-extension"
          x="0"
          y="5.25"
          width="5.25"
          height="1.5"
        />

        {/* Movable pixels */}
        {/* Bottom pixel */}
        <rect class="pixel-bottom" x="8.25" y="9" width="1.5" height="1.5" />
        {/* Right pixel */}
        <rect class="pixel-right" x="14.25" y="5.25" width="1.5" height="1.5" />
        {/* Top pixel */}
        <rect class="pixel-top" x="8.25" y="0" width="1.5" height="1.5" />
        {/* Left pixel */}
        <rect class="pixel-left" x="5.25" y="5.25" width="1.5" height="1.5" />
      </g>
    </svg>
  );
};
