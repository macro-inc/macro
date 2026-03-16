import { createUniqueId } from 'solid-js';

export const AnimatedShareIcon = (props: { triggerAnimation?: boolean }) => {
  const maskRightPersonId = createUniqueId();
  const clipBottomId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-share-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated share icon</title>*/}
      <defs>
        {/* Mask for right person - hides areas behind left person and bottom */}
        <mask id={maskRightPersonId} maskUnits="userSpaceOnUse">
          {/* White base = visible */}
          <rect x="-10" y="-40" width="100" height="140" fill="white" />
          {/* Black where left head is = hidden (animates with left head) */}
          <circle
            class="mask-left-head"
            fill="black"
            cx="5.48"
            cy="4"
            r="5.5"
          />
          {/* Black where left shoulders are = hidden */}
          <circle fill="black" cx="5.48" cy="13.5" r="7" />
          {/* Black at bottom = hidden */}
          <rect fill="black" y="12" width="20" height="10" />
        </mask>

        {/* Clip path to cut off bottom of left shoulders */}
        <clipPath id={clipBottomId}>
          <rect x="0" y="0" width="20" height="12" />
        </clipPath>
      </defs>

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

        .animated-share-icon .head-left,
        .animated-share-icon .head-right,
        .animated-share-icon .mask-left-head {
          transition: transform 0.4s ease;
        }

        .animated-share-icon.animating .head-left,
        .animated-share-icon.animating .mask-left-head {
          animation: head-bounce 0.25s ease-out;
        }

        .animated-share-icon.animating .head-right {
          animation: head-bounce 0.25s ease-out 0.15s;
        }
      `}</style>

      {/* Right person (behind) - masked to hide behind left person */}
      <g mask={`url(#${maskRightPersonId})`}>
        {/* Head */}
        <path
          class="head-right"
          d="M12.48 8C10.27 8 8.48 6.21 8.48 4C8.48 1.79 10.27 0 12.48 0C14.69 0 16.48 1.79 16.48 4C16.48 6.21 14.69 8 12.48 8ZM12.48 1.5C11.1 1.5 9.98 2.62 9.98 4C9.98 5.38 11.1 6.5 12.48 6.5C13.86 6.5 14.98 5.38 14.98 4C14.98 2.62 13.86 1.5 12.48 1.5Z"
        />
        {/* Shoulders */}
        <path
          class="shoulders-right"
          d="M12.48 19.5C9.31 19.5 6.73 16.92 6.73 13.75C6.73 10.58 9.31 8 12.48 8C15.65 8 18.23 10.58 18.23 13.75C18.23 16.92 15.65 19.5 12.48 19.5ZM12.48 9.5C10.14 9.5 8.23 11.41 8.23 13.75C8.23 16.09 10.14 18 12.48 18C14.82 18 16.73 16.09 16.73 13.75C16.73 11.41 14.82 9.5 12.48 9.5Z"
        />
      </g>

      {/* Left person (front) */}
      {/* Head - no clipping needed */}
      <path
        class="head-left"
        d="M5.48 8C3.27 8 1.48 6.21 1.48 4C1.48 1.79 3.27 0 5.48 0C7.69 0 9.48 1.79 9.48 4C9.48 6.21 7.69 8 5.48 8ZM5.48 1.5C4.1 1.5 2.98 2.62 2.98 4C2.98 5.38 4.1 6.5 5.48 6.5C6.86 6.5 7.98 5.38 7.98 4C7.98 2.62 6.86 1.5 5.48 1.5Z"
      />
      {/* Shoulders - clipped at bottom */}
      <g clip-path={`url(#${clipBottomId})`}>
        <path
          class="shoulders-left"
          d="M5.48 19.5C2.31 19.5 -0.27 16.92 -0.27 13.75C-0.27 10.58 2.31 8 5.48 8C8.65 8 11.23 10.58 11.23 13.75C11.23 16.92 8.65 19.5 5.48 19.5ZM5.48 9.5C3.14 9.5 1.23 11.41 1.23 13.75C1.23 16.09 3.14 18 5.48 18C7.82 18 9.73 16.09 9.73 13.75C9.73 11.41 7.82 9.5 5.48 9.5Z"
        />
      </g>
    </svg>
  );
};
