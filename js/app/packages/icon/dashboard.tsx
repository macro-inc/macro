import { createUniqueId } from 'solid-js';

export const AnimatedDashboardIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const id = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-dashboard-icon-${id} ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-dashboard-icon-${id} {
          .tile-tl, .tile-tr, .tile-bl, .tile-br {
            transition: transform 0.3s ease;
            transform-origin: center;
          }
        }
        .animated-dashboard-icon-${id}.animating {
          .tile-tl {
            transform: translate(-0.5px, -0.5px);
          }
          .tile-tr {
            transform: translate(0.5px, -0.5px);
          }
          .tile-bl {
            transform: translate(-0.5px, 0.5px);
          }
          .tile-br {
            transform: translate(0.5px, 0.5px);
          }
        }
      `}</style>
      <rect class="tile-tl" x="1" y="1" width="7" height="5" rx="1" />
      <rect class="tile-tr" x="10" y="1" width="7" height="7" rx="1" />
      <rect class="tile-bl" x="1" y="8" width="7" height="9" rx="1" />
      <rect class="tile-br" x="10" y="10" width="7" height="7" rx="1" />
    </svg>
  );
};
