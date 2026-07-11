import { createUniqueId } from 'solid-js';

export const AnimatedNewSplitIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      class={`animated-new-split-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated new split icon</title>*/}
      <defs>
        {/*
          Covering mask: white = show, black = hide. The black rect starts at x=9
          (just right of the plus, which ends at x=7.5), then slides left by 7.5px in
          sync with the rect, progressively covering the plus as the split forms.
        */}
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
          .plus {
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
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
          .plus {
            transform: translateX(1px);
          }
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

      {/* Plus — masked so the sliding rect covers it as the split forms. The inner
          group nudges right on animation so the left round cap is fully covered. */}
      <g mask={`url(#${maskId})`}>
        <g class="plus">
          <line x1="1.5" y1="9" x2="7.5" y2="9" />
          <line x1="4.5" y1="6" x2="4.5" y2="12" />
        </g>
      </g>

      {/* Existing panel — slides left by exactly its own width, ending at x≈2–8.5 */}
      <rect
        class="rect"
        x="9.5625"
        y="2.0625"
        width="6.375"
        height="13.875"
        rx="1.5"
      />

      {/* New panel — wider, left edge overlapping the slid panel's right edge */}
      <rect
        class="rect-new"
        x="8.0625"
        y="2.0625"
        width="7.875"
        height="13.875"
        rx="1.5"
      />
    </svg>
  );
};
