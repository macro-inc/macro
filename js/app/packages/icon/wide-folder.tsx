import { createUniqueId } from 'solid-js';

export const AnimatedFolderIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  const maskId = createUniqueId();
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
      class={`animated-folder-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
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
        {/* White backing extends past y=0 so the raised sheet's top edge isn't clipped */}
        <rect x="0" y="-5" width="18" height="20" fill="white" />
        {/* Folder interior — hides the part of the sheet tucked behind the folder */}
        <path
          class="mask-shape"
          d="M7.36 0.75L9 2.25H17.25V11.25H0.75V0.75H7.36Z"
          fill="black"
        />
      </mask>
      <path
        class="folder"
        d="M2.25 0.75H7.36L9 2.25H15.75A1.5 1.5 0 0 1 17.25 3.75V9.75A1.5 1.5 0 0 1 15.75 11.25H2.25A1.5 1.5 0 0 1 0.75 9.75V2.25A1.5 1.5 0 0 1 2.25 0.75Z"
      />
      <rect
        class="paper"
        mask={`url(#${maskId})`}
        x="3"
        y="3"
        width="12"
        height="7.5"
        rx="0.9375"
      />
    </svg>
  );
};
