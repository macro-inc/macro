export const AnimatedFileCodeIcon = (props: {
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
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-file-code-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated code file icon</title>*/}
      <style>{`
        @keyframes underline-move {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(2.75px);
          }
        }
        @keyframes blink {
          0%, 50% {
            opacity: 1;
          }
          51%, 100% {
            opacity: 0;
          }
        }
        .animated-file-code-icon {
          .underline-1, .underline-2 {
            transform-origin: 0 14.35px;
            transition: transform 0.4s ease;
          }
          .place-rectangle {
            opacity: 0;
          }
        }
        .animated-file-code-icon.animating {
          .underline-1 {
            animation: underline-move 0.4s ease forwards;
          }
          .underline-2 {
            animation: underline-move 0.4s ease forwards 0.2s;
          }
          .place-rectangle {
            animation: blink 1s step-start infinite 0.4s;
          }
        }
      `}</style>
      <rect x="0.47" y="0.47" width="17.06" height="11.06" rx="1.5" />
      <path d="M3.375 3.75L6.75 6L3.375 8.25" />
      <line class="underline-1" x1="7.3125" y1="8.25" x2="10.6875" y2="8.25" />
      <line class="underline-2" x1="7.3125" y1="8.25" x2="10.6875" y2="8.25" />
      <rect
        class="place-rectangle"
        x="9.5"
        y="3"
        width="4.5"
        height="6"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
};
