export const DiagramIcon = (props: { triggerAnimation?: boolean }) => {
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
      <title>Animated canvas icon</title>
      <style>{`
        .center-node {
          transition: transform 0.4s ease;
          transform-origin: center;
        }
        .animating .center-node {
          transform: translate(0, -0.5px);
        }
        .left-arm {
          transition: transform 0.4s ease;
          transform-origin: center;
        }
        .animating .left-arm {
          transform: translate(0, -1px) scaleY(0.8);
        }
        .right-arm {
          transition: transform 0.4s ease;
          transform-origin: center;
        }
        .animating .right-arm {
          transform: translate(0, 2.5px) scaleY(0.8);
        }
        .right-node {
          transition: transform 0.4s ease;
          transform-origin: center;
        }
        .animating .right-node {
          transform: translate(0, 10px);
        }
      `}</style>
      <path
        class="center-node"
        d="M16.1199 7.33998H12.4499L8.95988 3.84998L5.46988 7.33998H1.87988V8.83998H5.45988L8.94988 12.34L12.4399 8.83998H16.1099V7.33998H16.1199ZM8.94988 10.22L6.82988 8.09998L8.94988 5.97998L11.0699 8.09998L8.94988 10.22Z"
      />
      <path
        class="right-arm"
        d="M16.1201 4.58997H14.6201V8.08997H16.1201V4.58997Z"
      />
      <path
        class="right-node"
        d="M18 5.25H12.75V0H18V5.25ZM14.25 3.75H16.5V1.5H14.25V3.75Z"
      />
      <path
        class="left-arm"
        d="M3.37988 4.58997H1.87988V8.08997H3.37988V4.58997Z"
      />
      <path
        class="left-node"
        d="M5.25 5.25H0V0H5.25V5.25ZM1.5 3.75H3.75V1.5H1.5V3.75Z"
      />
    </svg>
  );
};
