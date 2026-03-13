import { createUniqueId } from 'solid-js';

export const AnimatedFolderIcon = (props: { triggerAnimation?: boolean }) => {
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
      class={`animated-folder-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      {/*<title>Animated folder icon</title>*/}
      <style>{`
        .animated-folder-icon {
          .paper, .folder {
            transform-origin: center;
            transition: transform 0.4s ease;
          }
          #${maskId} .mask-shape {
            transform-origin: center;
            transition: transform 0.4s ease;
          }
        }
        .animated-folder-icon.animating {
          .paper {
            transform: translate(0, -2.5px);
          }
          .folder {
            transform: translate(0, 2.5px);
          }
          #${maskId} .mask-shape {
            transform: translate(0, 5px);
          }
        }
      `}</style>
      <mask id={maskId}>
        <rect width="18" height="12" fill="white" />
        <path
          class="mask-shape"
          d="M7.36 0.75L9 2.25H17.25V11.25H0.75V0.75H7.36Z"
          fill="black"
        />
      </mask>
      <g class="folder">
        <path d="M17.25 1.5H9.29L7.66 0H1.5V1.5H7.08L8.71 3H16.5V10.5L18 10.52V2.25C18 1.84 17.66 1.5 17.25 1.5Z" />
        <path d="M1.5 1.5H0V11.25C0 11.66 0.34 12 0.75 12H16.5V10.5H1.5V1.5Z" />
      </g>
      <path
        class="paper"
        mask={`url(#${maskId})`}
        d="M15.75 6.75H14.25V3H3.75V5.25H2.25V1.5H15.75V6.75Z"
      />
    </svg>
  );
};
