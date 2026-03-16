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
      {/*<title>Animated search icon</title>*/}
      <defs>
        {/* Clip path for the reflection - matches the glass circle */}
        <clipPath id={clipId}>
          <circle cx="5.25" cy="5.25" r="5.25" />
        </clipPath>
      </defs>
      <style>{`
        .animated-search-icon {
          .magnifying-glass {
            transform-origin: 5.25px 5.25px;
            transition: transform 0.4s ease;
            transform: rotate(-45deg);

            .line-west {
              transform-origin: -0.25px 5px;
              transition: transform 0.4s ease;
              transform: translate(0, 0) scaleX(0);
            }

            .line-north {
              transform-origin: 5.25px 0px;
              transition: transform 0.4s ease;
              transform: translate(0, 0) scaleY(0);
            }

            .line-east {
              transform-origin: 10.75px 5px;
              transition: transform 0.4s ease;
              transform: translate(0, 0) scaleX(0);
            }

            .line-south {
              transition: transform 0.4s ease;
              transform: translate(0, 0);
            }
          }
        }
        .animated-search-icon.animating {
          .magnifying-glass {
            transform: translate(3.75px, 0.75px) rotate(0deg);

            .line-west {
              transform: translate(2px, 0) scaleX(1);
            }
            .line-east {
              transform: translate(-2px, 0) scaleX(1);
            }
            .line-north {
              transform: translate(0, 2px) scaleY(1);
            }
            .line-south {
              transform: translate(0, -2px);
            }
          }
        }
      `}</style>

      <g class="magnifying-glass">
        {/* Magnifying glass circle (lens) */}
        <path
          class="glass"
          d="M5.25,10.5c-2.9,0-5.25-2.36-5.25-5.25S2.35,0,5.25,0s5.25,2.35,5.25,5.25-2.35,5.25-5.25,5.25ZM5.25,1.5c-2.07,0-3.75,1.68-3.75,3.75s1.68,3.75,3.75,3.75,3.75-1.68,3.75-3.75-1.68-3.75-3.75-3.75Z"
        />

        <line
          class="line-south"
          x1="5.25"
          y1="10.5"
          x2="5.25"
          y2="13.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />

        <line
          class="line-west"
          x1="-3.25"
          y1="5"
          x2="-.25"
          y2="5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />

        <line
          class="line-north"
          x1="5.25"
          y1="-3"
          x2="5.25"
          y2="0"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />

        <line
          class="line-east"
          x1="10.75"
          y1="5"
          x2="13.75"
          y2="5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </g>

      {/* Handle */}
      {/* <path
        class="handle"
        d="M11.25,12c-.19,0-.38-.07-.53-.22l-2.5-2.5c-.29-.29-.29-.77,0-1.06s.77-.29,1.06,0l2.5,2.5c.29.29.29.77,0,1.06-.15.15-.34.22-.53.22Z"
      /> */}

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
