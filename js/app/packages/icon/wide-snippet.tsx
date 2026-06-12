export const AnimatedSnippetIcon = (props: {
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
      class={`animated-snippet-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-snippet-icon {
          .brace-left, .brace-right {
            transition: transform 0.25s ease;
          }
          .line-2 {
            transform-origin: 0% 50%;
            transform: scaleX(.676);
            transition: transform 0.25s ease-out;
            transform-box: fill-box;
          }
        }
        .animated-snippet-icon.animating {
          .brace-left {
            transform: translateX(-0.75px);
          }
          .brace-right {
            transform: translateX(0.75px);
          }
          .line-2 {
            transform: scaleX(1);
          }
        }
      `}</style>
      {/* Curly braces hug the text; they spread apart as the snippet "expands" */}
      <path
        class="brace-left"
        d="M4.1 0.47 Q2.2 0.47 2.2 2.3 L2.2 3.9 Q2.2 5.53 0.95 5.53 Q2.2 5.53 2.2 7.16 L2.2 8.76 Q2.2 10.59 4.1 10.59"
      />
      <path
        class="brace-right"
        d="M13.9 0.47 Q15.8 0.47 15.8 2.3 L15.8 3.9 Q15.8 5.53 17.05 5.53 Q15.8 5.53 15.8 7.16 L15.8 8.76 Q15.8 10.59 13.9 10.59"
      />
      <rect
        x="5.6"
        y="2.9"
        width="6.8"
        height="1.125"
        rx="0.5625"
        fill="currentColor"
        stroke="none"
      />
      <rect
        class="line-2"
        x="5.6"
        y="7.02"
        width="6.8"
        height="1.125"
        rx="0.5625"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
};
