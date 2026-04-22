export const AnimatedCallIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
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
        <path d="M12.56,12c-3.49,0-6.83-1.29-9.38-3.58h0s-.2-.19-.2-.19c-.08-.08-.17-.16-.25-.24l-.15-.14c-.2-.19-.61-.66-.82-.91-.09-.11-.17-.22-.25-.33l-.08-.1c-.14-.18-.27-.36-.4-.54-.11-.16-.22-.32-.32-.49-.17-.27-.41-.9-.51-1.26-.07-.27-.29-1.16-.16-1.56.1-.3.12-.35,3.46-2.53l.13-.07c.43-.17.92.03,1.1.46.36.87,1.39,2.28,2.09,3,.32.34.31.87-.02,1.2l-.52.51c1.37,1.47,3.46,2.33,5.39,2.29v-.75c0-.43.33-.79.77-.83.09,0,.29-.02.56-.03.68-.03,2.74-.13,3.23-.32.43-.17.92.03,1.09.47l.05.2.4,3.59v.22s-.06.37-.06.37c-.09.19-.25.34-.44.42-1.51.71-2.26,1.02-4,1.12-.12,0-.24,0-.36,0-.12,0-.25,0-.37,0ZM3.76,6.91c2.4,2.37,5.66,3.69,9.05,3.59h.13c.09,0,.18,0,.27,0,1.31-.08,1.9-.28,3.05-.8l-.28-2.5c-.67.1-1.61.17-2.8.22v1.47s-.66.08-.66.08c-2.92.36-6.06-.97-7.85-3.33l-.4-.53,1.04-1.02c-.56-.66-1.18-1.52-1.61-2.29-.88.58-1.74,1.16-2.17,1.46.03.18.07.41.12.57.08.29.27.75.33.85.09.15.19.29.29.44.11.17.23.32.35.48l.08.11c.07.09.14.19.21.28.23.27.58.67.7.79l-.08.11.1-.1.13.13ZM12.58,7.44s0,0,0,0c0,0,0,0,0,0ZM16.79,7s0,0,0,0c0,0,0,0,0,0ZM13.19,6.78h0s0,0,0,0ZM5.76,3.65h0s0,0,0,0ZM3.35,1.1h0s0,0,0,0Z" />
      </g>
    </svg>
  );
};
