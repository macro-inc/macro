export const AnimatedSortIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -4.5 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-sort-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Animated sort icon</title>*/}
      <style>{`
        .animated-sort-icon {
          .line-top {
            transition: transform 0.3s ease-in-out;
          }
          .line-bottom {
            transition: transform 0.3s ease-in-out 0.07s;
          }
        }
        .animated-sort-icon.animating {
          .line-top {
            transform: translateY(7.5px);
          }
          .line-bottom {
            transform: translateY(-7.5px);
          }
        }
      `}</style>

      {/* Top line - widest */}
      <rect class="line-top" width="18" height="1.5" />
      {/* Middle line */}
      <rect class="line-middle" x="3" y="3.75" width="12" height="1.5" />
      {/* Bottom line - narrowest */}
      <rect class="line-bottom" x="6" y="7.5" width="6" height="1.5" />
    </svg>
  );
};
