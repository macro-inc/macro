export const AnimatedChannelIcon = (props: {
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
      class={`animated-channel-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated channel icon</title>*/}
      <style>{`
        @keyframes head-bounce {
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
        .animated-channel-icon {
          .head-left, .head-center, .head-right {
            transition: transform 0.4s ease;
          }
        }
        .animated-channel-icon.animating {
          .head-left {
            animation: head-bounce .2s;
          }
          .head-center {
            animation: head-bounce .2s 0.2s;
          }
          .head-right {
            animation: head-bounce .2s 0.4s;
          }
        }
      `}</style>
      <circle class="head-center" cx="12" cy="8" r="3.04" />
      <circle class="head-right" cx="20.333" cy="3.667" r="3.04" />
      <circle class="head-left" cx="3.667" cy="3.667" r="3.04" />
      <path d="M0 9.99C0.9 8.99 2.23 8.33 3.693 8.33C5.16 8.33 6.44 8.96 7.333 9.94" />
      <path d="M16.667 9.99C17.567 8.99 18.894 8.33 20.36 8.33C21.827 8.33 23.107 8.96 24 9.94" />
      <path d="M7.107 16C7.887 14.06 9.78 12.667 12.007 12.667C14.234 12.667 16.12 14.06 16.907 16" />
    </svg>
  );
};
