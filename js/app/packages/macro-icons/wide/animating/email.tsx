export const EmailIcon = (props: { triggerAnimation?: boolean }) => {
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
      <title>Animated email icon</title>
      <style>{`
        @keyframes disappear {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes appear {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        .triangle {
          opacity: 0;
        }
        .animating .triangle {
          animation: appear 0.0s ease forwards .4s;
        }
        .notch {
          opacity: 0;
          translate: -.5px .5px;
        }
        .animating .notch {
          animation: appear 0.2s ease forwards .4s;
        }
        .right-line {
          transform-origin: 17.25px .75px;
          transition: rotate 0.4s ease;
        }
        .animating .right-line {
          rotate: 50.5deg;
          animation: disappear 0.4s ease forwards .4s;
        }
        .left-line {
          transform-origin: .75px .75px;
          transition: rotate 0.4s ease;
        }
        .animating .left-line {
          rotate: -20deg;
          animation: disappear 0.4s ease forwards .4s;
        }
        .bottom-line {
          transform-origin: .75px 10.75px;
          transition: transform 0.4s ease;
        }
        .animating .bottom-line {
          transform: translate(3.5px, 0) rotate(-40deg);
          animation: disappear 0.4s ease forwards .4s;
        }
        .left-flap {
          transform-origin: 1.23px 0.17px;
          transition: rotate 0.4s ease;
        }
        .animating .left-flap {
          rotate: 30deg;
          animation: disappear 0.4s ease forwards .4s;
        }
        .right-flap-1 {
          transform-origin: 17.73px 1.33px;
          transition: transform 0.4s ease;
        }
        .animating .right-flap-1 {
          transform: translate(-4px, 3.1px);
          animation: disappear 0.4s ease forwards .4s;
        }
      `}</style>
      <mask id="square-mask" mask-type="luminance">
        <rect x="0" y="0" width="18" height="18" fill="white" />
        <rect x="-1" y="-1" width="2.5" height="2.5" fill="black" />
      </mask>
      <g mask="url(#square-mask)">
        <path
          class="triangle"
          d="M4.60001 12C4.53001 12 4.47001 12 4.40001 11.97C4.16001 11.91 3.98001 11.73 3.89001 11.5L0.0500093 1.01C-0.0399907 0.78 9.32813e-06 0.52 0.140009 0.32C0.280009 0.12 0.510009 0 0.750009 0H17.25C17.57 0 17.85 0.2 17.96 0.5C18.07 0.8 17.98 1.13 17.73 1.33L5.08001 11.83C4.94001 11.94 4.77001 12 4.60001 12ZM1.82001 1.5L4.93001 9.99L15.17 1.5H1.82001Z"
        />
        <path
          class="notch"
          d="M7.55006 4.04004L3.06006 4.89004L3.58006 6.30004L7.55006 4.04004Z"
        />
        <path
          class="top-line"
          d="M17.25 0H1.5V1.5H17.25C17.66 1.5 18 1.16 18 0.75C18 0.34 17.66 0 17.25 0Z"
        />
        <path
          class="right-line"
          d="M17.25 0C16.84 0 16.5 0.34 16.5 0.75V10.5H18V0.75C18 0.34 17.66 0 17.25 0Z"
        />
        <path
          class="bottom-line"
          d="M0.75 12H16.5V10.5H0.75C0.34 10.5 0 10.84 0 11.25C0 11.66 0.34 12 0.75 12Z"
        />
        <path
          class="left-line"
          d="M0.75 12C1.16 12 1.5 11.66 1.5 11.25V1.5H0V11.25C0 11.66 0.34 12 0.75 12Z"
        />
        <path
          class="left-flap"
          d="M9.00002 8.57004L0.27002 1.33004L1.23002 0.170044L9.00002 6.62004"
        />
        <path
          class="right-flap-1"
          d="M9 6.62004L16.77 0.170044L17.73 1.33004L9 8.57004"
        />
        <path
          class="right-flap-2"
          d="M9 6.62004L16.77 0.170044L17.73 1.33004L9 8.57004"
        />
      </g>
    </svg>
  );
};
