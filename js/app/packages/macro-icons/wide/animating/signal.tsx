import { createUniqueId } from 'solid-js';

export const AnimatedSignalIcon = (props: { triggerAnimation?: boolean }) => {
  const maskId = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      class={`animated-signal-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated signal icon</title>
      <style>{`
        @keyframes move-left {
          0% {
            transform: translate(0, 0);
          }
          50% {
            transform: translate(-5px, 0);
          }
          100% {
            transform: translate(0, 0);
          }
        }
        @keyframes move-right {
          0% {
            transform: translate(0, 0);
          }
          50% {
            transform: translate(5px, 0);
          }
          100% {
            transform: translate(0, 0);
          }
        }
        @keyframes rotate-out-and-back {
          0% {
            transform: rotate(0);
          }
          20%, 80% {
            transform: rotate(78deg);
          }
          100% {
            transform: rotate(0);
          }
        }
        @keyframes cycle-left {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(-9.37px, 0);
          }
        }
        @keyframes disappear-reappear {
          0% { opacity: 1; }
          10%, 90% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes appear-disappear {
          0% { opacity: 0; }
          10%, 90% { opacity: 1; }
          100% { opacity: 0; }
        }
        .animated-signal-icon {
          .left-arm, .right-arm {
            transition: transform 0.2s ease;
          }
          .left-arm {
            transform-origin: 4.3px 6px;
          }
          .right-arm {
            transform-origin: 13.7px 6px;
          }
          .long-wave {
            transform-origin: 9px 6px;
            translate: 2px 0;
          }
        }
        .animated-signal-icon.animating {
          .left-arm, .right-arm {
            animation: rotate-out-and-back 0.8s ease forwards, disappear-reappear 0.4s ease forwards 0.2s;
          }
          .short-wave {
            animation: disappear-reappear 0.4s ease forwards 0.2s;
          }
          .long-wave {
            animation: cycle-left 0.4s ease forwards 0.3s;
          }
          #${maskId} {
            .left-box {
              animation: move-left 0.8s ease forwards;
            }
            .right-box {
              animation: move-right 0.8s ease forwards;
            }
          }
        }
      `}</style>
      <mask id={maskId}>
        <rect x="0" y="0" width="18" height="18" fill="white" />
        <rect
          class="left-box"
          x="-.5"
          y="0"
          width="5.5"
          height="18"
          fill="black"
        />
        <rect
          class="right-box"
          x="13"
          y="0"
          width="5.5"
          height="18"
          fill="black"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path
          class="long-wave"
          transform="translate(6px, 0)"
          d="M42 12C40.23 12 39.63 9.29 38.93 6.16C38.65 4.88 37.89 1.5 37.33 1.5C36.77 1.5 36.01 4.89 35.73 6.16C35.03 9.29 34.43 12 32.66 12C30.89 12 30.29 9.29 29.59 6.16C29.31 4.88 28.55 1.5 27.99 1.5C27.43 1.5 26.67 4.89 26.39 6.16C25.69 9.29 25.09 12 23.32 12C21.55 12 20.95 9.29 20.26 6.16C19.98 4.88 19.22 1.5 18.66 1.5C18.1 1.5 17.34 4.89 17.06 6.16C16.36 9.29 15.76 12 14 12C12.24 12 11.63 9.29 10.94 6.16C10.66 4.89 9.9 1.5 9.34 1.5C8.78 1.5 8.02 4.89 7.74 6.16C7.04 9.29 6.44 12 4.68 12C2.92 12 2.31 9.29 1.62 6.16C1.32 4.89 0.56 1.5 0 1.5V0C1.77 0 2.37 2.71 3.06 5.84C3.34 7.11 4.1 10.5 4.66 10.5C5.22 10.5 5.98 7.11 6.26 5.84C6.96 2.71 7.56 0 9.32 0C11.08 0 11.69 2.71 12.38 5.84C12.66 7.12 13.42 10.5 13.98 10.5C14.54 10.5 15.3 7.11 15.58 5.84C16.28 2.71 16.88 0 18.65 0C20.42 0 21.02 2.71 21.71 5.84C21.99 7.11 22.75 10.5 23.31 10.5C23.87 10.5 24.63 7.11 24.91 5.84C25.61 2.71 26.21 0 27.97 0C29.73 0 30.34 2.7 31.04 5.84C31.32 7.12 32.08 10.5 32.64 10.5C33.2 10.5 33.96 7.11 34.24 5.84C34.94 2.71 35.54 0 37.31 0C39.08 0 39.68 2.71 40.38 5.84C40.66 7.12 41.42 10.5 41.98 10.5V12H42Z"
        />
      </g>
      <path
        class="left-arm"
        d="M4.3 5.25H0V6.75H4.3C4.71 6.75 5.05 6.41 5.05 6C5.05 5.59 4.71 5.25 4.3 5.25Z"
      />
      <path
        class="right-arm"
        d="M13.7 5.25H18V6.75H13.7C13.29 6.75 12.95 6.41 12.95 6C12.95 5.59 13.29 5.25 13.7 5.25Z"
      />
      <path
        class="short-wave"
        d="M13.0599 6.75H14.5999C14.5199 6.4 14.4499 6.08 14.3899 5.84C13.6899 2.71 13.0899 0 11.3199 0C9.54988 0 8.94988 2.71 8.24988 5.84C7.96988 7.12 7.20988 10.5 6.64988 10.5C6.08988 10.5 5.32988 7.11 5.04988 5.84C5.00988 5.64 4.95988 5.45 4.91988 5.25H3.37988C3.45988 5.6 3.52988 5.92 3.58988 6.16C4.28988 9.29 4.88988 12 6.64988 12C8.40988 12 9.01988 9.29 9.71988 6.16C9.99988 4.89 10.7599 1.5 11.3199 1.5C11.8799 1.5 12.6399 4.89 12.9199 6.16C12.9599 6.36 13.0099 6.55 13.0499 6.75H13.0599Z"
      />
    </svg>
  );
};
