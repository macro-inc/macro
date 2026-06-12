export const AnimatedPlusIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-plus-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated plus icon</title>*/}
      <style>{`
        .animated-plus-icon {
          .bg-fill { opacity: 0; transition: opacity 0.3s ease; }
          .frame, .plus-v, .plus-h {
            transform-origin: 9px 9px;
            transition: transform 0.3s ease;
          }
        }
        .animated-plus-icon.animating {
          .bg-fill { opacity: 0.1; transition: opacity 0.4s ease; }
          .frame, .plus-v, .plus-h {
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .frame { transform: scale(1.05); }
          .plus-v { transform: scaleY(1.3); }
          .plus-h { transform: scaleX(1.3); }
        }
      `}</style>
      <rect
        class="bg-fill"
        x="0"
        y="0"
        width="18"
        height="18"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        class="frame"
        x="0.5625"
        y="0.5625"
        width="16.875"
        height="16.875"
        rx="1.5"
      />
      <line class="plus-v" x1="9" y1="6.75" x2="9" y2="11.25" />
      <line class="plus-h" x1="6.75" y1="9" x2="11.25" y2="9" />
    </svg>
  );
};
