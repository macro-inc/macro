export const AnimatedFileMdIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-file-md-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated markdown file icon</title>*/}
      <style>{`
        .animated-file-md-icon {
          .file-frame {
            transition: height 0.2s ease;
          }
          .line-2 {
            transform-origin: 0% 50%;
            transform: scaleX(.666);
            transition: transform 0.2s ease-out;
            transform-box: fill-box;
          }
          .line-3 {
            transform-origin: 0% 50%;
            transform: scaleX(0);
            transition: transform 0.2s ease-out 0.2s;
            transform-box: fill-box;
          }
        }
        .animated-file-md-icon.animating {
          .file-frame {
            height: 14.0625px;
          }
          .line-2, .line-3 {
            transform: scaleX(1);
          }
        }
      `}</style>
      {/* Clean rounded frame; grows taller (top fixed, bottom drops 3px) as the file "unfolds" */}
      <rect
        class="file-frame"
        x="0.46875"
        y="0.46875"
        width="17.0625"
        height="11.0625"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.125"
      />
      <rect x="3" y="3.9375" width="12" height="1.125" rx="0.5625" />
      <rect
        class="line-2"
        x="3"
        y="6.9375"
        width="12"
        height="1.125"
        rx="0.5625"
      />
      <rect
        class="line-3"
        x="3"
        y="9.9375"
        width="8"
        height="1.125"
        rx="0.5625"
      />
    </svg>
  );
};
