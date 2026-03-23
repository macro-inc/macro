import { createUniqueId } from 'solid-js';

export const AnimatedSlidersIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 12"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-sliders-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated sliders icon</title>*/}
      <style>{`
        @keyframes v-slide-left {
          0%, 100% { transform: translateY(0); }
          40%, 60% { transform: translateY(-4px); }
        }
        @keyframes v-slide-middle {
          0%, 100% { transform: translateY(0); }
          40%, 60% { transform: translateY(4px); }
        }
        @keyframes v-slide-right {
          0%, 100% { transform: translateY(0); }
          40%, 60% { transform: translateY(-4px); }
        }
        .animated-sliders-icon.animating {
          .handle-left, .mask-left {
            animation: v-slide-left 0.6s ease-in-out forwards;
          }
          .handle-middle, .mask-middle {
            animation: v-slide-middle 0.6s ease-in-out 0.08s forwards;
          }
          .handle-right, .mask-right {
            animation: v-slide-right 0.6s ease-in-out 0.16s forwards;
          }
        }
      `}</style>

      <defs>
        <mask id={maskId}>
          <rect x="-5" y="-5" width="30" height="25" fill="white" />
          {/* Cut out inner squares of handles */}
          <rect
            class="mask-left"
            x="1.5"
            y="7"
            width="2"
            height="2"
            fill="black"
          />
          <rect
            class="mask-middle"
            x="8"
            y="3"
            width="2"
            height="2"
            fill="black"
          />
          <rect
            class="mask-right"
            x="14.5"
            y="7"
            width="2"
            height="2"
            fill="black"
          />
        </mask>
      </defs>

      {/* Track lines - masked behind handle cutouts */}
      <g mask={`url(#${maskId})`}>
        <rect x="1.75" y="0" width="1.5" height="12" />
        <rect x="8.25" y="0" width="1.5" height="12" />
        <rect x="14.75" y="0" width="1.5" height="12" />
      </g>

      {/* Handle outlines (outer rect minus inner rect creates outline effect) */}
      {/* Left handle - starts at bottom */}
      <path
        class="handle-left"
        d="M0,5.5 h5 v5 h-5 v-5 Z M1.5,7 h2 v2 h-2 v-2 Z"
        fill-rule="evenodd"
      />
      {/* Middle handle - starts at top */}
      <path
        class="handle-middle"
        d="M6.5,1.5 h5 v5 h-5 v-5 Z M8,3 h2 v2 h-2 v-2 Z"
        fill-rule="evenodd"
      />
      {/* Right handle - starts at bottom */}
      <path
        class="handle-right"
        d="M13,5.5 h5 v5 h-5 v-5 Z M14.5,7 h2 v2 h-2 v-2 Z"
        fill-rule="evenodd"
      />
    </svg>
  );
};
