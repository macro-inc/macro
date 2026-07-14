export const AnimatedContactIcon = (props: {
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
      class={`animated-contact-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated contact icon</title>*/}
      <style>{`
        @keyframes head-bob {
          0% { transform: translateY(0); }
          50% { transform: translateY(-1px); }
          80% { transform: translateY(0.5px); }
          100% { transform: translateY(0); }
        }
        @keyframes line-bounce-in {
          0% { transform: translateX(0); }
          45% { transform: translateX(-1.25px); }
          100% { transform: translateX(0); }
        }
        .animated-contact-icon .head {
          transform-box: fill-box;
          transform-origin: center;
        }
        .animated-contact-icon.animating {
          .head {
            animation: head-bob 0.4s ease-out;
          }
          .line-1 {
            animation: line-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .line-2 {
            animation: line-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.08s;
          }
          .line-3 {
            animation: line-bounce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.16s;
          }
        }
      `}</style>

      {/* Head */}
      <path
        class="head"
        d="M5.75 5.75C7.13071 5.75 8.25 4.63071 8.25 3.25C8.25 1.86929 7.13071 0.75 5.75 0.75C4.36929 0.75 3.25 1.86929 3.25 3.25C3.25 4.63071 4.36929 5.75 5.75 5.75Z"
        stroke-miterlimit="10"
      />
      {/* Shoulders */}
      <path
        d="M0.75 11.375A5.0446 5.0446 0 0 1 10.75 11.375"
        stroke-miterlimit="10"
      />
      {/* Lines (top -> bottom) */}
      <path
        class="line-1"
        d="M17.25 3H11.25"
        stroke-miterlimit="10"
        stroke-linecap="round"
      />
      <path
        class="line-2"
        d="M17.25 6H11.25"
        stroke-miterlimit="10"
        stroke-linecap="round"
      />
      <path
        class="line-3"
        d="M17.25 9H14.25"
        stroke-miterlimit="10"
        stroke-linecap="round"
      />
    </svg>
  );
};
