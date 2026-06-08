import { cn } from '@ui';
import { createUniqueId } from 'solid-js';

export const AnimatedStarIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={cn(
        'animated-star-icon',
        props.triggerAnimation && 'animating',
        props.class
      )}
    >
      {/*<title>Animated star icon</title>*/}
      <style>{`
        .animated-star-icon {
          .star-inflate, .star-eye, #${maskId} .inflated-rhombus {
            transform-origin: 9px 6px;
            transition: transform 0.4s ease;
          }
        }
        .animated-star-icon.animating {
          .star-inflate, #${maskId} .inflated-rhombus {
            transform: scale(2.22);
          }
          .star-eye {
            transform: scale(2);
          }
        }
      `}</style>
      <mask id={maskId}>
        <rect x="0" y="0" width="18" height="18" fill="white" />
        <path
          class="inflated-rhombus"
          d="M8.9700 7.5470C8.1870 7.0250 7.9350 6.7730 7.4130 5.9900C7.9350 5.2070 8.1870 4.9550 8.9700 4.4330C9.7530 4.9550 10.0050 5.2070 10.5270 5.9900C10.0050 6.7730 9.7530 7.0250 8.9700 7.5470Z"
          fill="black"
        />
      </mask>
      <path
        mask={`url(#${maskId})`}
        d="M17.23 5.521C10.27 5.521 9.439 4.54 9.439 0.7C9.439 0.31 9.2313 0 8.97 0C8.7087 0 8.501 0.31 8.501 0.7C8.501 4.54 7.66 5.521 0.71 5.521C0.32 5.521 0.01 5.7287 0.01 5.99C0.01 6.2513 0.32 6.459 0.71 6.459C7.67 6.459 8.501 7.44 8.501 11.28C8.501 11.67 8.7087 11.98 8.97 11.98C9.2313 11.98 9.439 11.67 9.439 11.28C9.439 7.44 10.28 6.459 17.23 6.459C17.62 6.459 17.93 6.2513 17.93 5.99C17.93 5.7287 17.62 5.521 17.23 5.521ZM8.97 8.2425L6.7175 5.99L8.97 3.7375L11.2225 5.99L8.97 8.2425Z"
      />
      <path
        class="star-eye"
        d="M8.96997 6.73999C9.38418 6.73999 9.71997 6.4042 9.71997 5.98999C9.71997 5.57578 9.38418 5.23999 8.96997 5.23999C8.55576 5.23999 8.21997 5.57578 8.21997 5.98999C8.21997 6.4042 8.55576 6.73999 8.96997 6.73999Z"
      />
      <path
        class="star-inflate"
        d="M12.7599 5.6500C11.7858 5.5937 9.4305 4.3185 9.2499 3.4300C9.1899 3.3400 9.0999 3.2900 8.9899 3.2900C8.8799 3.2900 8.7799 3.3500 8.7299 3.4300C8.5397 4.3210 6.1650 5.6270 5.1799 5.7000C5.0299 5.7300 4.9199 5.8600 4.9199 6.0100C4.9199 6.1600 5.0299 6.2900 5.1799 6.3200C6.1541 6.3864 8.5100 7.6518 8.6899 8.5400C8.7499 8.6300 8.8399 8.6800 8.9499 8.6900C9.0599 8.6900 9.1599 8.6300 9.2199 8.5500C9.4078 7.6597 11.7848 6.3532 12.7699 6.2800C12.9199 6.2500 13.0299 6.1200 13.0299 5.9700C13.0299 5.8200 12.9199 5.6900 12.7699 5.6600L12.7599 5.6500ZM8.9699 7.5470C8.1869 7.0250 7.9349 6.7730 7.4129 5.9900C7.9349 5.2070 8.1869 4.9550 8.9699 4.4330C9.7529 4.9550 10.0049 5.2070 10.5269 5.9900C10.0049 6.7730 9.7529 7.0250 8.9699 7.5470Z"
      />
    </svg>
  );
};
