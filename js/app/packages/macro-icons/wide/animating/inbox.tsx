import { createUniqueId } from 'solid-js';

export const AnimatedInboxIcon = (props: { triggerAnimation?: boolean }) => {
  const maskId = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="2.5 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-inbox-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated inbox icon</title>*/}
      <style>{`
        .animated-inbox-icon {
          .right-bar {
            transform-origin: 16.8px 0.75px;
            transition: transform 0.2s ease;
            transform: rotate(61.28deg);
          }
          .left-bar {
            transform-origin: 6.2px 0.75px;
            transition: transform 0.2s ease;
            transform: rotate(-61.28deg);
          }
          .envelope {
            transform-origin: center;
            transition: transform 0.2s ease;
          }
          .envelope, .tray, .right-line, .left-bottom-lines, .left-bar .over, .right-bar .over {
            transition: transform 0.2s ease;
          }
          .envelope {
            transition: transform 0.4s ease;
          }
          #${maskId} .moving-mask-parts {
            transition: transform 0.2s ease;
          }
        }
        .animated-inbox-icon.animating {
          .envelope {
            transform: translate(0px, -3.5px) rotate(5deg);
          }
          .tray, .right-line, .left-bottom-lines, #${maskId} .moving-mask-parts {
            transform: translate(0, 3px);
          }
          .left-bar {
            transform: rotate(-70deg);
            .over {
              transform: translate(-2.7px, 0);
            }
          }
          .right-bar {
            transform: rotate(70deg);
            .over {
              transform: translate(2.7px, 0);
            }
          }
        }
      `}</style>
      <mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <rect fill="black" x="4.5" y="-0.5" width="2" height="2" />
        {/* moving parts of mask */}
        <g class="moving-mask-parts">
          <polygon
            fill="black"
            points="14.4 6.75 13.65 7.98 9.31 7.98 8.56 6.75 3.98 6.75 3.98 10.5 18.98 10.5 18.98 6.75 14.4 6.75"
          />
          <rect fill="black" x="18.98" y="10.5" width="2" height="1.5" />
          <rect fill="black" x="2.48" y="12" width="18" height="9" />
        </g>
      </mask>

      <g mask={`url(#${maskId})`}>
        {/* Envelope icon in tray */}
        <g class="envelope">
          <rect x="12" y="9.5" width="1.5" height="1.5" />
          <path d="M15.48,14.5H7.48c-.41,0-.75-.34-.75-.75v-6.5c0-.41.34-.75.75-.75h8c.41,0,.75.34.75.75v6.5c0,.41-.34.75-.75.75ZM8.23,13h6.5v-5h-6.5v5Z" />
        </g>

        {/* Top bar */}
        <path d="M16.67,1.5H6.49c-.41,0-.75-.34-.75-.75S6.08,0,6.49,0h10.18c.41,0,.75.34.75.75s-.34.75-.75.75Z" />

        {/* Right vertical line */}
        <rect class="right-line" x="18.98" y="5.8" width="1.5" height="4.7" />

        {/* Left and bottom lines */}
        <path
          class="left-bottom-lines"
          d="M18.98,12H3.23c-.41,0-.75-.34-.75-.75v-5.45h1.5v4.7h15v1.5Z"
        />

        {/* Tray shape */}
        <polygon
          class="tray"
          points="13.65 7.98 9.31 7.98 8.56 6.75 3.23 6.75 3.23 5.25 9.4 5.25 10.15 6.48 12.81 6.48 13.56 5.25 19.73 5.25 19.73 6.75 14.4 6.75 13.65 7.98"
        />

        {/* Right extension bar */}
        <g class="right-bar">
          <path
            class="under"
            d="M22.96,0h-6.21c-.41,0-.75.34-.75.75,0,.41.34.75.75.75h6.21s0-1.5,0-1.5Z"
          />
          <path
            class="over"
            d="M22.96,0h-6.21c-.41,0-.75.34-.75.75,0,.41.34.75.75.75h6.21s0-1.5,0-1.5Z"
          />
        </g>

        {/* Left extension bar */}
        <g class="left-bar">
          <path
            class="under"
            d="M0,0h6.21c.41,0,.75.34.75.75,0,.41-.34.75-.75.75H0S0,0,0,0Z"
          />
          <path
            class="over"
            d="M0,0h6.21c.41,0,.75.34.75.75,0,.41-.34.75-.75.75H0S0,0,0,0Z"
          />
        </g>
      </g>
    </svg>
  );
};
