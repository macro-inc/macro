import { createUniqueId } from 'solid-js';

export const AnimatedNewSplitIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();
  const notchMaskId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      class={`animated-new-split-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated new split icon</title>*/}
      <defs>
        {/*
          Mask: white = show, black = hide.
          The black rect starts at x=9 (just right of the plus, which ends at x=7.5),
          then slides left by 7.5px in sync with the rect, progressively covering the plus.
          Inline reactive style is used so the mask element reliably transitions
          inside <defs> across all browsers.
        */}
        {/* Notch mask: cuts 1.5×1.5px squares from the top-left and bottom-right of the 15×15 content area */}
        <mask id={notchMaskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="18" height="18" fill="white" />
          {/* Extended left to the viewbox edge so the notch holds during leftward bounce overshoot */}
          <rect x="0" y="1.5" width="3" height="1.5" fill="black" />
          {/* Extended right to the viewbox edge so the notch holds during rightward bounce overshoot */}
          <rect x="15" y="15" width="3" height="1.5" fill="black" />
        </mask>

        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="18" height="18" fill="white" />
          <rect
            x="9"
            y="0"
            width="9"
            height="18"
            fill="black"
            style={{
              transform: props.triggerAnimation
                ? 'translateX(-7.5px)'
                : 'translateX(0px)',
              transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        </mask>
      </defs>

      <style>{`
        .animated-new-split-icon {
          .rect {
            transition: transform 0.3s ease;
          }
          .rect-new {
            opacity: 0;
            transform: translateX(5px);
            transition: opacity 0.15s ease, transform 0.3s ease;
          }
        }
        .animated-new-split-icon.animating {
          .rect {
            transform: translateX(-7.5px);
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .rect-new {
            opacity: 1;
            transform: translateX(0);
            transition: opacity 0.2s ease 0.15s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s;
          }
        }
      `}</style>

      <g mask={`url(#${notchMaskId})`}>
        {/* Plus — masked so the sliding rect properly covers it */}
        <polygon
          mask={`url(#${maskId})`}
          points="7.5 8.25 5.25 8.25 5.25 6 3.75 6 3.75 8.25 1.5 8.25 1.5 9.75 3.75 9.75 3.75 12 5.25 12 5.25 9.75 7.5 9.75 7.5 8.25"
        />

        {/* Existing rect — slides left by exactly its own width, ending at x=1.5–9 */}
        <g class="rect">
          <path d="M16.5,16.5h-6.65c-.47,0-.85-.38-.85-.85V1.5h6.65c.47,0,.85.38.85.85v14.15ZM10.5,15h4.5V3h-4.5v12Z" />
        </g>

        {/* New rect — 1.5px wider, left edge at x=7.5 so its border overlaps the slid rect's right border */}
        <g class="rect-new">
          <path d="M16.5,16.5h-8.15c-.47,0-.85-.38-.85-.85V1.5h8.15c.47,0,.85.38.85.85v14.15ZM9,15h6V3H9v12Z" />
        </g>
      </g>
    </svg>
  );
};
