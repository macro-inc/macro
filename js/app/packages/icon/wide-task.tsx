export const AnimatedTaskIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-task-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated task icon</title>*/}
      <style>{`
        .animated-task-icon {
          .box {
            transition: transform 0.4s ease;
          }
          .checkmark {
            transition: transform 0.4s ease;
          }
        }
        .animated-task-icon.animating {
          .box {
            transform: translateY(6px);
          }
          .checkmark {
            transform: translateY(-7.5px);
          }
        }
      `}</style>
      <rect
        class="box"
        x="0.46875"
        y="0.46875"
        width="5.0625"
        height="5.0625"
        rx="1.5"
      />
      <polyline class="checkmark" points="0.535,8.465 3.01,10.94 6.55,7.4" />
      <rect
        x="8"
        y="2.4375"
        width="10"
        height="1.125"
        rx="0.5625"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="8"
        y="8.5575"
        width="10"
        height="1.125"
        rx="0.5625"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
};
