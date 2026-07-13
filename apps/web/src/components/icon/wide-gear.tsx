export const AnimatedGearIcon = (props: { triggerAnimation?: boolean }) => {
  // Gear icon from Asset 181.svg.
  // On hover: rotates 45° with spring easing, snaps back instantly on mouse leave.

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-miterlimit="10"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-gear-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated gear icon</title>*/}
      <style>{`
        @keyframes gear-rotate {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(45deg); }
        }

        .animated-gear-icon .gear-group {
          transform-origin: 9.03px 9.03px;
        }

        .animated-gear-icon.animating .gear-group {
          animation: gear-rotate 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>

      <g class="gear-group">
        <path d="M17.18,6.74l-.77-1.85-1.76-.02c-.42-.56-.91-1.05-1.46-1.46l-.02-1.77-1.85-.77-1.26,1.23c-.68-.1-1.37-.1-2.06,0l-1.26-1.23-1.85.77-.02,1.76c-.56.42-1.05.91-1.46,1.46l-1.77.02-.77,1.85,1.23,1.26c-.1.68-.1,1.37,0,2.06l-1.23,1.26.77,1.85,1.76.02c.42.56.91,1.05,1.46,1.46l.02,1.77,1.85.77,1.26-1.23c.68.1,1.37.1,2.06,0l1.26,1.23,1.85-.77.02-1.76c.56-.42,1.05-.91,1.46-1.46l1.77-.02.77-1.85-1.23-1.26c.1-.68.1-1.37,0-2.06l1.23-1.26Z" />
        <circle cx="9.03" cy="9.03" r="3.25" />
      </g>
    </svg>
  );
};
