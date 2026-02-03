export const FileMdIcon = (props: { triggerAnimation?: boolean }) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.triggerAnimation ? 'animating' : ''}
    >
      <title>Animated markdown file icon</title>
      <style>{`
        .lower-l {
          transition: transform 0.2s ease;
          transform-origin: center;
        }
          .lower-extension {
          transition: transform 0.2s ease;
          transform-origin: center;
        }
        .animating .lower-l {
          transform: translateY(3px);
        }
        .animating .line-2 {
          transition: transform 0.2s ease-out;
          transform: scale(1, 1);
        }
        .animating .line-3 {
          transition: transform 0.2s ease-out 0.2s;
          transform: scale(1, 1);
        }
        .animating .lower-extension {
          transition: transform 0.2s ease;
          transform: translateY(3px);
        }
      `}</style>
      <path
        class="upper-l"
        d="M17.25 0H1.5V1.5H16.5V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z"
      />
      <path
        class="lower-l"
        d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z"
      />
      <path class="line-1" d="M15 3.75H3V5.25H15V3.75Z" />
      <path
        class="line-2"
        transform-origin="3 7.5"
        transform="scale(.666, 1)"
        d="M15 6.75H3V8.25H15V6.75Z"
      />
      <path
        class="line-3"
        transform-origin="3 10.5"
        transform="scale(0, 1)"
        d="M11 9.75H3V11.25H11V9.75Z"
      />
      <path class="upper-extension" d="M1.5 1.5H0V4.5H1.5V1.5Z" />
      <path class="lower-extension" d="M18 7.5H16.5V10.5H18V7.5Z" />
    </svg>
  );
};
