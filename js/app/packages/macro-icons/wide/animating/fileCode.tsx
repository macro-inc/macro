export const FileCodeIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.triggerAnimation ? 'animating' : ''}
    >
      <title>Animated code file icon</title>
      <style>{`
        @keyframes underline-move {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(2.8px);
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
        .underline-1 {
          transform-origin: center;
          transition: transform 0.4s ease;
        }
        .animating .underline-1 {
          animation: underline-move 0.4s ease forwards;
        }
        .underline-2 {
          transform-origin: center;
          transition: transform 0.4s ease;
        }
        .animating .underline-2 {
          animation: underline-move 0.4s ease forwards 0.2s;
        }
        .place-rectangle {
          opacity: 0;
        }
        .animating .place-rectangle {
          animation: blink 1s step-start infinite 0.4s;
        }
      `}</style>
      <path d="M17.25 0H1.5V1.5H16.5V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z" />
      <path d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z" />
      <path
        class="underline-1"
        d="M11.25 7.72998H6.75V8.97998H11.25V7.72998Z"
      />
      <path d="M3 3.02002V4.52002L5.24 6.00002L3 7.49002V8.98002L7.5 6.00002L3 3.02002Z" />
      <path
        class="underline-2"
        d="M11.25 7.72998H6.75V8.97998H11.25V7.72998Z"
      />
      <path class="place-rectangle" d="M14 3H9.5V9H14V3Z" />
    </svg>
  );
};
