export const AnimatedFileCodeIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-file-code-icon ${props.triggerAnimation ? 'animating' : ''}`}
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
      <path d="M17.25 0H1.5V1.5H16.5V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z" />
      <path d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z" />
      <rect class="underline-1" x="6.75" y="7.75" width="4.5" height="1.25" />
      <path d="M3 3.02002V4.52002L5.24 6.00002L3 7.49002V8.98002L7.5 6.00002L3 3.02002Z" />
      <rect class="underline-2" x="6.75" y="7.75" width="4.5" height="1.25" />
      <rect class="place-rectangle" x="9.5" y="3" width="4.5" height="6" />
    </svg>
  );
};
