const FRAME_A_D = 'M 1.5,0.75 L 17.25,0.75 L 17.25,10.5';
const FRAME_B_D = 'M 16.5,11.25 L 0.75,11.25 L 0.75,1.5';

export const AnimatedPlusIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-plus-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated plus icon</title>
      <style>{`
        .animated-plus-icon {
          .bg-fill { opacity: 0; transition: opacity 0.3s ease; }
          .frame-a, .frame-b, .plus-v, .plus-h {
            transition: transform 0.3s ease;
          }
          .plus-v { transform-origin: 9px 6px; }
          .plus-h { transform-origin: 9px 6px; }
        }
        .animated-plus-icon.animating {
          .bg-fill { opacity: 0.2; transition: opacity 0.4s ease; }
          .frame-a, .frame-b, .plus-v, .plus-h {
            transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .frame-a { transform: translate(1px, -1px); }
          .frame-b { transform: translate(-1px, 1px); }
          .plus-v { transform: scaleY(1.3); }
          .plus-h { transform: scaleX(1.3); }
        }
      `}</style>
      <rect
        class="bg-fill"
        x="0"
        y="0"
        width="18"
        height="12"
        fill="currentColor"
        stroke="none"
      />
      <path class="frame-a" d={FRAME_A_D} stroke-linejoin="round" />
      <path class="frame-b" d={FRAME_B_D} stroke-linejoin="round" />
      <line
        class="plus-v"
        x1="9"
        y1="3.75"
        x2="9"
        y2="8.25"
        stroke-linecap="square"
        shape-rendering="crispEdges"
      />
      <line
        class="plus-h"
        x1="6.75"
        y1="6"
        x2="11.25"
        y2="6"
        stroke-linecap="square"
        shape-rendering="crispEdges"
      />
    </svg>
  );
};
