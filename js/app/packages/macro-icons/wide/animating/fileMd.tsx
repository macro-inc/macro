export const AnimatedFileMdIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-file-md-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated markdown file icon</title>
      <style>{`
        .animated-file-md-icon {
          .lower-l, .lower-extension {
            transition: transform 0.2s ease;
            transform-origin: center;
          }
          .line-2 {
            transform-origin: 15 6.75;
            transform: scale(.666, 1);
            transition: transform 0.2s ease-out;
            transform-box: fill-box;
          }
          .line-3 {
            transform-origin: 11 9.75;
            transform: scale(0, 1);
            transition: transform 0.2s ease-out 0.2s;
            transform-box: fill-box;
          }
        }
        .animated-file-md-icon.animating {
          .lower-l {
            transform: translateY(3px);
          }
          .line-2, .line-3 {
            transform: scale(1,1);
          }
          .lower-extension {
            transform: translateY(3px);
          }
        }
      `}</style>
      <path d="M17.25 0H1.5V1.5H16.5V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z" />
      <path
        class="lower-l"
        d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z"
      />
      <path d="M15 3.75H3V5.25H15V3.75Z" />
      <rect class="line-2" x="3" y="6.75" width="12" height="1.5" />
      <rect class="line-3" x="3" y="9.75" width="8" height="1.5" />
      <path class="upper-extension" d="M1.5 1.5H0V4.5H1.5V1.5Z" />
      <path class="lower-extension" d="M18 7.5H16.5V10.5H18V7.5Z" />
    </svg>
  );
};
