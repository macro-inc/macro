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
      <title>Animated share icon</title>
      <defs>
        {/* Mask for right person - hides areas behind left person and bottom */}
        <mask id={maskRightPersonId} maskUnits="userSpaceOnUse">
          {/* White base = visible */}
          <rect x="-10" y="-10" width="100" height="100" fill="white" />
          {/* Black where left head is = hidden (animates with left head) */}
          <circle
            class="mask-left-head"
            fill="black"
            cx="7.74"
            cy="5.5"
            r="5.5"
          />
          {/* Black where left shoulders are = hidden */}
          <circle fill="black" cx="7.74" cy="15.25" r="7.25" />
          {/* Black at bottom = hidden */}
          <rect fill="black" y="13.5" width="23.24" height="9" />
        </mask>

        {/* Clip path to cut off bottom of left shoulders */}
        <clipPath id={clipBottomId}>
          <rect x="0" y="0" width="23.24" height="13.5" />
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
          d="M14.74,9.5c-2.21,0-4-1.79-4-4s1.79-4,4-4,4,1.79,4,4-1.79,4-4,4ZM14.74,3c-1.38,0-2.5,1.12-2.5,2.5s1.12,2.5,2.5,2.5,2.5-1.12,2.5-2.5-1.12-2.5-2.5-2.5Z"
        />
        {/* Shoulders */}
        <path
          class="shoulders-right"
          d="M14.74,21c-3.17,0-5.75-2.58-5.75-5.75s2.58-5.75,5.75-5.75,5.75,2.58,5.75,5.75-2.58,5.75-5.75,5.75ZM14.74,11c-2.34,0-4.25,1.91-4.25,4.25s1.91,4.25,4.25,4.25,4.25-1.91,4.25-4.25-1.91-4.25-4.25-4.25Z"
        />
      </g>

      {/* Left person (front) */}
      {/* Head - no clipping needed */}
      <path
        class="head-left"
        d="M7.74,9.5c-2.21,0-4-1.79-4-4S5.53,1.5,7.74,1.5s4,1.79,4,4-1.79,4-4,4ZM7.74,3c-1.38,0-2.5,1.12-2.5,2.5s1.12,2.5,2.5,2.5,2.5-1.12,2.5-2.5-1.12-2.5-2.5-2.5Z"
      />
      {/* Shoulders - clipped at bottom */}
      <g clip-path={`url(#${clipBottomId})`}>
        <path
          class="shoulders-left"
          d="M7.74,21c-3.17,0-5.75-2.58-5.75-5.75s2.58-5.75,5.75-5.75,5.75,2.58,5.75,5.75-2.58,5.75-5.75,5.75ZM7.74,11c-2.34,0-4.25,1.91-4.25,4.25s1.91,4.25,4.25,4.25,4.25-1.91,4.25-4.25-1.91-4.25-4.25-4.25Z"
        />
      </g>
    </svg>
  );
};
