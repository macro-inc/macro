export const AnimatedTaskIcon = (props: {
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
      <path class="box" d="M1.5 0V1.5H4.5V4.5H1.5V1.5H0V6H6V0H1.5Z" />
      <path
        class="checkmark"
        d="M3.01 12L0 9L1.07 7.93L3.01 9.88L6.02 6.87L7.08 7.93L3.01 12Z"
      />
      <path d="M18 2.25H8V3.75H18V2.25Z" />
      <path d="M18 8.37H8V9.87H18V8.37Z" />
    </svg>
  );
};
