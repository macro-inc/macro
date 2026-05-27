export const AnimatedSquareCommandKIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  // Terminal-prompt icon (`>` chevron + input line).
  // On hover: colors invert (tile fills with ink, strokes flip to surface) and the
  // input line blinks like a terminal cursor.
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="-1.5 -1.88 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={`animated-command-k-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated command-k icon</title>*/}
      <style>{`
        .animated-command-k-icon {
          .ck-bg {
            opacity: 0;
            transition: opacity 0.2s ease;
          }
          .ck-caret {
            stroke: currentColor;
            transition: stroke 0.2s ease;
            transform-origin: 0px 6.75px;
          }
          .ck-input {
            stroke: currentColor;
            transition: stroke 0.2s ease;
            transform-origin: 6px 13.49px;
          }

          &.animating {
            .ck-bg { opacity: 1; }
            .ck-caret {
              stroke: var(--color-surface);
            }
            .ck-input {
              stroke: var(--color-surface);
              transform: scaleX(0.8);
              animation: ck-cursor-blink 1s steps(1, end) infinite;
              animation-delay: 0.2s;
            }
          }
        }

        @keyframes ck-cursor-blink {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
      `}</style>

      {/* Inverted background tile */}
      <rect
        class="ck-bg"
        x="-1.5"
        y="-1.88"
        width="18"
        height="18"
        rx="2.5"
        fill="currentColor"
      />

      {/* Prompt chevron + input line */}
      <polyline
        class="ck-caret"
        points="0.75 0.75 6.75 6.75 0.75 12.75"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <line
        class="ck-input"
        x1="6"
        y1="13.49"
        x2="15"
        y2="13.49"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
};
