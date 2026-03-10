import { createUniqueId } from 'solid-js';

export const AnimatedSearchIcon = (props: { triggerAnimation?: boolean }) => {
  const clipId = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-search-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated search icon</title>
      <defs>
        {/* Clip path for the reflection - matches the glass circle */}
        <clipPath id={clipId}>
          <circle cx="5.25" cy="5.25" r="5.25" />
        </clipPath>
      </defs>
      <style>{`
        .animated-search-icon .handle {
          transform-origin: 5.25px 5.25px;
          transition: transform 0.3s ease-out;
        }

        .animated-search-icon .reflection {
          opacity: 0;
        }

        .animated-search-icon.animating .handle {
          animation: search-handle-rotate 0.6s ease-in-out forwards;
        }

        .animated-search-icon.animating .reflection {
          animation: search-reflection-sweep 0.4s ease-in-out forwards 0.1s;
        }

        @keyframes search-handle-rotate {
          0% {
            transform: rotate(0deg);
          }
          50% {
            transform: rotate(-20deg);
          }
          100% {
            transform: rotate(0deg);
          }
        }

        @keyframes search-reflection-sweep {
          0% {
            opacity: 1;
            transform: rotate(45deg) translate(-8px, 0);
          }
          100% {
            opacity: 0;
            transform: rotate(45deg) translate(8px, 0);
          }
        }
      `}</style>

      {/* Magnifying glass circle (lens) */}
      <path
        class="glass"
        d="M5.25,10.5c-2.9,0-5.25-2.36-5.25-5.25S2.35,0,5.25,0s5.25,2.35,5.25,5.25-2.35,5.25-5.25,5.25ZM5.25,1.5c-2.07,0-3.75,1.68-3.75,3.75s1.68,3.75,3.75,3.75,3.75-1.68,3.75-3.75-1.68-3.75-3.75-3.75Z"
      />

      {/* Handle */}
      <path
        class="handle"
        d="M11.25,12c-.19,0-.38-.07-.53-.22l-2.5-2.5c-.29-.29-.29-.77,0-1.06s.77-.29,1.06,0l2.5,2.5c.29.29.29.77,0,1.06-.15.15-.34.22-.53.22Z"
      />

      {/* Reflection shine effect - clipped to the glass circle */}
      <g clip-path={`url(#${clipId})`}>
        <rect
          class="reflection"
          x="4"
          y="-4"
          width="4"
          height="18"
          opacity="0"
        />
      </g>
    </svg>
  );
};
