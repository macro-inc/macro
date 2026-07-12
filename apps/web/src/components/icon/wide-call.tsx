export const AnimatedCallIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-1.5 -1.5 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-call-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        @keyframes phone-ring {
          0%   { transform: rotate(0deg); }
          10%  { transform: rotate(-14deg); }
          25%  { transform: rotate(12deg); }
          40%  { transform: rotate(-8deg); }
          55%  { transform: rotate(6deg); }
          65%  { transform: rotate(-3deg); }
          75%  { transform: rotate(0deg); }
          100% { transform: rotate(0deg); }
        }
        .animated-call-icon .phone {
          transform-box: fill-box;
          transform-origin: center;
        }
        .animated-call-icon.animating .phone {
          animation: phone-ring 1s ease-in-out infinite;
        }
      `}</style>

      <g class="phone">
        <path d="M13.94,10.8c.17.07.29.23.3.41.02.45-.04.88-.19,1.3-.25.73-.8,1.29-1.53,1.55-1.41.51-3.16-.03-4.46-.67-2.02-1-3.87-2.64-5.22-4.45-.47-.63-.88-1.3-1.23-2C.97,5.62.44,3.85.96,2.43c.26-.7.8-1.23,1.51-1.49.4-.14.81-.2,1.24-.2.2,0,.4.09.48.29l1.24,3.19c.08.2,0,.47-.16.62l-.84.85c-.1.1-.17.23-.2.37-.04.17,0,.32.11.46,1.1,1.61,2.5,3.01,4.11,4.11.13.09.27.15.43.12s.3-.09.41-.2l.85-.84c.14-.14.41-.24.6-.16l3.18,1.24Z" />
      </g>
    </svg>
  );
};
