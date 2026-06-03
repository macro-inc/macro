export const AnimatedChatIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-chat-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated chat icon</title>*/}
      <style>{`
        @keyframes dot-bounce {
          0% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-2px);
          }
          80% {
            transform: translateY(1px);
          }
          100% {
            transform: translateY(0);
          }
        }
        .animated-chat-icon {
          .dot-1, .dot-2, .dot-3 {
            transition: transform 0.4s ease;
          }
        }
        .animated-chat-icon.animating {
          .dot-1 {
            animation: dot-bounce .2s;
          }
          .dot-2 {
            animation: dot-bounce .2s 0.2s;
          }
          .dot-3 {
            animation: dot-bounce .2s 0.4s;
          }
        }
      `}</style>
      <path d="M2.625 0.625L21.375 0.625A2 2 0 0 1 23.375 2.625L23.375 18L20.75 15.375L2.625 15.375A2 2 0 0 1 0.625 13.375L0.625 2.625A2 2 0 0 1 2.625 0.625Z" />
      <circle
        class="dot-1"
        cx="8"
        cy="8"
        r="1.2"
        fill="currentColor"
        stroke="none"
      />
      <circle
        class="dot-2"
        cx="12"
        cy="8"
        r="1.2"
        fill="currentColor"
        stroke="none"
      />
      <circle
        class="dot-3"
        cx="16"
        cy="8"
        r="1.2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
};
