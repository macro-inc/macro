export const AnimatedChatIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4 24 24"
      fill="currentColor"
      stroke="none"
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
      <path d="M23 0H2V2H22V14H24V1C24 0.453333 23.5467 0 23 0Z" />
      <path d="M2 2H0V15C0 15.5467 0.453333 16 1 16H20L22 18V14H2V2Z" />
      <path class="dot-1" d="M9 7H7V9H9V7Z" />
      <path class="dot-2" d="M13 7H11V9H13V7Z" />
      <path class="dot-3" d="M17 7H15V9H17V7Z" />
    </svg>
  );
};
