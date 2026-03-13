import { createUniqueId } from 'solid-js';

export const AnimatedProfileIcon = (props: { triggerAnimation?: boolean }) => {
  const frameMaskId = createUniqueId();
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
      class={`animated-profile-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated profile icon</title>*/}
      <defs>
        {/* Mask to hide frame behind person */}
        <mask id={frameMaskId} maskUnits="userSpaceOnUse">
          <rect x="-10" y="-10" width="100" height="100" fill="white" />
          {/* Hide bottom area - must come before head so it doesn't animate */}
          <rect
            class="bottom-mask"
            fill="black"
            x="-10"
            y="12"
            width="100"
            height="20"
          />
          {/* Hide behind head */}
          <circle class="head-mask" fill="black" cx="9" cy="3.75" r="5.25" />
        </mask>

        {/* Clip to cut off shoulders at bottom */}
        <clipPath id={clipBottomId}>
          <rect x="-10" y="-10" width="100" height="22" />
        </clipPath>
      </defs>

      <style>{`
        @keyframes head-nod {
          0% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(2px);
          }
          100% {
            transform: translateY(0);
          }
        }

        .animated-profile-icon .head,
        .animated-profile-icon .head-mask {
          transition: transform 0.3s ease;
        }

        .animated-profile-icon.animating .head,
        .animated-profile-icon.animating .head-mask {
          animation: head-nod 0.3s ease-out;
        }

        .animated-profile-icon .bottom-mask {
          transform: none !important;
          animation: none !important;
        }
      `}</style>

      {/* Frame pieces - masked behind person */}
      <g mask={`url(#${frameMaskId})`}>
        {/* Top-right corner bracket */}
        <path d="M17.25,0h-8.25v1.5h7.5v9h1.5V0.75c0-.41-.34-.75-.75-.75Z" />
        {/* Top-left bar */}
        <rect x="1.5" y="0" width="7.5" height="1.5" />
        {/* Bottom-left corner bracket */}
        <path d="M0.75,12h3.25v-1.5h-2.5V1.5h-1.5v9.75c0,.41.34.75.75.75Z" />
        {/* Bottom-right bar */}
        <rect x="13.5" y="10.5" width="3" height="1.5" />
      </g>

      {/* Person shapes */}
      <g clip-path={`url(#${clipBottomId})`}>
        {/* Head - bobs down and up */}
        <path
          class="head"
          d="M9,7.5c-2.07,0-3.75-1.68-3.75-3.75s1.68-3.75,3.75-3.75,3.75,1.68,3.75,3.75-1.68,3.75-3.75,3.75ZM9,1.5c-1.24,0-2.25,1.01-2.25,2.25s1.01,2.25,2.25,2.25,2.25-1.01,2.25-2.25-1.01-2.25-2.25-2.25Z"
        />
        {/* Shoulders - static */}
        <path d="M9,20.54c-3.6,0-6.52-2.92-6.52-6.52s2.93-6.52,6.52-6.52,6.52,2.93,6.52,6.52-2.93,6.52-6.52,6.52ZM9,9c-2.77,0-5.02,2.25-5.02,5.02s2.25,5.02,5.02,5.02,5.02-2.25,5.02-5.02-2.25-5.02-5.02-5.02Z" />
      </g>
    </svg>
  );
};
