export const AnimatedUsersIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-users-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated users icon</title>*/}
      <style>{`
        @keyframes users-head-bounce {
          0% { transform: translateY(0); }
          50% { transform: translateY(-1.3px); }
          80% { transform: translateY(0.6px); }
          100% { transform: translateY(0); }
        }

        .animated-users-icon .head-left,
        .animated-users-icon .head-right {
          transition: transform 0.4s ease;
        }

        .animated-users-icon.animating .head-left {
          animation: users-head-bounce 0.25s ease-out;
        }

        /* behind person nods a beat later */
        .animated-users-icon.animating .head-right {
          animation: users-head-bounce 0.25s ease-out 0.15s;
        }
      `}</style>

      {/* Right person (behind) — head crescent + shoulders */}
      <path class="head-right" d="M10.62 1.34A3.25 3.25 0 1 1 10.62 6.66" />
      <path d="M10.6 9.12A4.98 4.98 0 0 1 17.15 12" />

      {/* Left person (front) — full head + shoulders */}
      <circle class="head-left" cx="5.48" cy="4" r="3.25" />
      <path d="M0.8 12A4.98 4.98 0 0 1 10.14 12" />
    </svg>
  );
};
