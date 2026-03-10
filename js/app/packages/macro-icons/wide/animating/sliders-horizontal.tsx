import { createUniqueId } from 'solid-js';

export const AnimatedSlidersHorizontalIcon = (props: {
  triggerAnimation?: boolean;
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
      class={`animated-sliders-horizontal-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated sliders horizontal icon</title>
      <style>{`
        @keyframes slide-right {
          0%, 100% { translate: 0; }
          40%, 60% { translate: 9px; }
        }
        @keyframes slide-left {
          0%, 100% { translate: 0; }
          40%, 60% { translate: -9px; }
        }
        @keyframes squish-h {
          0%, 100% { scale: 1 1; }
          50% { scale: 1.15 1; }
        }
        @keyframes squish-v {
          0%, 100% { scale: 1 1; translate: 0 0; }
          50% { scale: 1 0.85; translate: 0 0; }
        }
        @keyframes squish-top-edge {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 0.45px; }
        }
        @keyframes squish-bottom-edge {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -0.45px; }
        }
        @keyframes squish-left-edge {
          0%, 100% { translate: 0 0; scale: 1 1; }
          50% { translate: -0.45px 0; scale: 1 0.85; }
        }
        @keyframes squish-right-edge {
          0%, 100% { translate: 0 0; scale: 1 1; }
          50% { translate: 0.45px 0; scale: 1 0.85; }
        }
        @keyframes squish-mask {
          0%, 100% { scale: 1 1; }
          50% { scale: 1.15 0.85; }
        }
        .animated-sliders-horizontal-icon {
          .handle-top-h { transform-origin: 4.5px 0; }
          .handle-top-v-left { transform-origin: 1.5px 3px; }
          .handle-top-v-right { transform-origin: 7.5px 3px; }
          .handle-bottom-h { transform-origin: 13.5px 6px; }
          .handle-bottom-v-left { transform-origin: 10.5px 9px; }
          .handle-bottom-v-right { transform-origin: 15.75px 9px; }
          .mask-top { transform-origin: 4.5px 3px; }
          .mask-bottom { transform-origin: 13.5px 9px; }
        }
        .animated-sliders-horizontal-icon.animating {
          .handle-top {
            animation: slide-right 0.6s ease-in-out forwards;
          }
          .handle-bottom {
            animation: slide-left 0.6s ease-in-out forwards;
          }
          .mask-top {
            animation: slide-right 0.6s ease-in-out forwards, squish-mask 0.3s ease-in-out 2 forwards;
          }
          .mask-bottom {
            animation: slide-left 0.6s ease-in-out forwards, squish-mask 0.3s ease-in-out 2 forwards;
          }
          .handle-top-h, .handle-bottom-h {
            animation: squish-h 0.3s ease-in-out 2 forwards;
          }
          .handle-top-top-edge, .handle-bottom-top-edge {
            animation: squish-top-edge 0.3s ease-in-out 2 forwards;
          }
          .handle-top-bottom-edge, .handle-bottom-bottom-edge {
            animation: squish-bottom-edge 0.3s ease-in-out 2 forwards;
          }
          .handle-top-v-left, .handle-bottom-v-left {
            animation: squish-left-edge 0.3s ease-in-out 2 forwards;
          }
          .handle-top-v-right, .handle-bottom-v-right {
            animation: squish-right-edge 0.3s ease-in-out 2 forwards;
          }
        }
      `}</style>

      <defs>
        <mask id={maskId}>
          <rect x="-5" y="-5" width="30" height="25" fill="white" />
          {/* Cut out inner squares of handles */}
          <rect
            class="mask-top"
            x="3"
            y="1.5"
            width="3"
            height="3"
            fill="black"
          />
          <rect
            class="mask-bottom"
            x="12"
            y="7.5"
            width="3"
            height="3"
            fill="black"
          />
        </mask>
      </defs>

      {/* Track lines - masked behind handle cutouts */}
      <g mask={`url(#${maskId})`}>
        <rect x="0" y="2.25" width="18" height="1.5" />
        <rect x="0" y="8.25" width="18" height="1.5" />
      </g>

      {/* Top handle - built from 4 edge rects */}
      <g class="handle-top">
        {/* Top edge */}
        <g class="handle-top-top-edge">
          <rect class="handle-top-h" x="1.5" y="0" width="6" height="1.5" />
        </g>
        {/* Bottom edge */}
        <g class="handle-top-bottom-edge">
          <rect class="handle-top-h" x="1.5" y="4.5" width="6" height="1.5" />
        </g>
        {/* Left edge */}
        <rect class="handle-top-v-left" x="1.5" y="1" width="1.5" height="4" />
        {/* Right edge */}
        <rect class="handle-top-v-right" x="6" y="1" width="1.5" height="4" />
      </g>

      {/* Bottom handle - built from 4 edge rects */}
      <g class="handle-bottom">
        {/* Top edge */}
        <g class="handle-bottom-top-edge">
          <rect class="handle-bottom-h" x="10.5" y="6" width="6" height="1.5" />
        </g>
        {/* Bottom edge */}
        <g class="handle-bottom-bottom-edge">
          <rect
            class="handle-bottom-h"
            x="10.5"
            y="10.5"
            width="6"
            height="1.5"
          />
        </g>
        {/* Left edge */}
        <rect
          class="handle-bottom-v-left"
          x="10.5"
          y="7"
          width="1.5"
          height="4"
        />
        {/* Right edge */}
        <rect
          class="handle-bottom-v-right"
          x="15"
          y="7"
          width="1.5"
          height="4"
        />
      </g>
    </svg>
  );
};
