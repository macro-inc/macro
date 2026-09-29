import { createEffect, createUniqueId } from 'solid-js';

// Animated line icons ported from the Macro app (js/app/packages/icon/*.tsx).
// Each takes a `triggerAnimation` prop (we drive it off the create-tile hover).

type IconProps = { triggerAnimation?: boolean; class?: string };

export const AnimatedStarIcon = (props: IconProps) => {
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
      class={`animated-star-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-star-icon {
          .star-inflate, .star-eye, #${maskId} .inflated-rhombus {
            transform-origin: 9px 6px;
            transition: transform 0.4s ease;
          }
        }
        .animated-star-icon.animating {
          .star-inflate, #${maskId} .inflated-rhombus { transform: scale(2.22); }
          .star-eye { transform: scale(2); }
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

export const AnimatedChatIcon = (props: IconProps) => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 -4 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    overflow="visible"
    class={`animated-chat-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
  >
    <style>{`
      @keyframes chat-dot-bounce {
        0% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
        80% { transform: translateY(1px); }
        100% { transform: translateY(0); }
      }
      .animated-chat-icon { .dot-1, .dot-2, .dot-3 { transition: transform 0.4s ease; } }
      .animated-chat-icon.animating {
        .dot-1 { animation: chat-dot-bounce .2s; }
        .dot-2 { animation: chat-dot-bounce .2s 0.2s; }
        .dot-3 { animation: chat-dot-bounce .2s 0.4s; }
      }
    `}</style>
    <path d="M2.625 0.625L21.375 0.625A2 2 0 0 1 23.375 2.625L23.375 18L20.75 15.375L2.625 15.375A2 2 0 0 1 0.625 13.375L0.625 2.625A2 2 0 0 1 2.625 0.625Z" />
    <circle
      class="dot-1"
      cx="8"
      cy="8"
      r="1.2"
      fill="currentColor"
      stroke="none"
    />
    <circle
      class="dot-2"
      cx="12"
      cy="8"
      r="1.2"
      fill="currentColor"
      stroke="none"
    />
    <circle
      class="dot-3"
      cx="16"
      cy="8"
      r="1.2"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const AnimatedTaskIcon = (props: IconProps) => (
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
    <style>{`
      .animated-task-icon { .box, .checkmark { transition: transform 0.4s ease; } }
      .animated-task-icon.animating {
        .box { transform: translateY(6px); }
        .checkmark { transform: translateY(-7.5px); }
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

export const AnimatedSnippetIcon = (props: IconProps) => (
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
    class={`animated-snippet-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
  >
    <style>{`
      .animated-snippet-icon {
        .brace-left, .brace-right { transition: transform 0.25s ease; }
        .line-2 {
          transform-origin: 0% 50%;
          transform: scaleX(.676);
          transition: transform 0.25s ease-out;
          transform-box: fill-box;
        }
      }
      .animated-snippet-icon.animating {
        .brace-left { transform: translateX(-0.75px); }
        .brace-right { transform: translateX(0.75px); }
        .line-2 { transform: scaleX(1); }
      }
    `}</style>
    <path
      class="brace-left"
      d="M4.1 0.47 Q2.2 0.47 2.2 2.3 L2.2 3.9 Q2.2 5.53 0.95 5.53 Q2.2 5.53 2.2 7.16 L2.2 8.76 Q2.2 10.59 4.1 10.59"
    />
    <path
      class="brace-right"
      d="M13.9 0.47 Q15.8 0.47 15.8 2.3 L15.8 3.9 Q15.8 5.53 17.05 5.53 Q15.8 5.53 15.8 7.16 L15.8 8.76 Q15.8 10.59 13.9 10.59"
    />
    <rect
      x="5.6"
      y="2.9"
      width="6.8"
      height="1.125"
      rx="0.5625"
      fill="currentColor"
      stroke="none"
    />
    <rect
      class="line-2"
      x="5.6"
      y="7.02"
      width="6.8"
      height="1.125"
      rx="0.5625"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const AnimatedFolderIcon = (props: IconProps) => {
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
      <style>{`
        .animated-folder-icon {
          .paper, .folder { transform-origin: center; transition: transform 0.4s ease; }
          #${maskId} .mask-shape { transform-origin: center; transition: transform 0.4s ease; }
        }
        .animated-folder-icon.animating {
          .paper { transform: translate(0, -2.5px); }
          .folder { transform: translate(0, 2.5px); }
          #${maskId} .mask-shape { transform: translate(0, 5px); }
        }
      `}</style>
      <mask id={maskId}>
        <rect x="0" y="-5" width="18" height="20" fill="white" />
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

export const AnimatedFileMdIcon = (props: IconProps) => (
  <svg
    width="100%"
    height="100%"
    viewBox="0 -3 18 18"
    fill="currentColor"
    stroke="none"
    xmlns="http://www.w3.org/2000/svg"
    overflow="visible"
    class={`animated-file-md-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
  >
    <style>{`
      .animated-file-md-icon {
        .file-frame { transition: height 0.2s ease; }
        .line-2 { transform-origin: 0% 50%; transform: scaleX(.666); transition: transform 0.2s ease-out; transform-box: fill-box; }
        .line-3 { transform-origin: 0% 50%; transform: scaleX(0); transition: transform 0.2s ease-out 0.2s; transform-box: fill-box; }
      }
      .animated-file-md-icon.animating {
        .file-frame { height: 14.0625px; }
        .line-2, .line-3 { transform: scaleX(1); }
      }
    `}</style>
    <rect
      class="file-frame"
      x="0.46875"
      y="0.46875"
      width="17.0625"
      height="11.0625"
      rx="1.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.125"
    />
    <rect x="3" y="3.9375" width="12" height="1.125" rx="0.5625" />
    <rect
      class="line-2"
      x="3"
      y="6.9375"
      width="12"
      height="1.125"
      rx="0.5625"
    />
    <rect
      class="line-3"
      x="3"
      y="9.9375"
      width="8"
      height="1.125"
      rx="0.5625"
    />
  </svg>
);

export const AnimatedDiagramIcon = (props: IconProps) => {
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
      class={`animated-diagram-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      <style>{`
        .animated-diagram-icon {
          .left-node, .right-node, .center-node, .left-arm, .right-arm { transition: transform 0.4s ease; }
          .left-arm { transform-origin: 2.625px 4.6875px; }
          .right-arm { transform-origin: 15.375px 4.6875px; }
          #${maskId} .cover-right { transition: transform 0.4s ease; }
        }
        .animated-diagram-icon.animating {
          .right-node { transform: translate(0, 9.5px); }
          .center-node { transform: translate(0, -0.75px); }
          .left-arm { transform: scaleY(0.78); }
          .right-arm { transform: translate(0, 2.65px) scaleY(0.8); }
          #${maskId} .cover-right { transform: translate(0, 9.5px); }
        }
      `}</style>
      <mask id={maskId} maskUnits="userSpaceOnUse">
        <rect x="-2" y="-3" width="22" height="22" fill="white" />
        <rect
          class="cover-right"
          fill="black"
          x="13.3125"
          y="0.5625"
          width="4.125"
          height="4.125"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <g class="center-node">
          <rect
            x="6.475"
            y="5.615"
            width="4.95"
            height="4.95"
            rx="1"
            transform="rotate(45 8.95 8.09)"
          />
          <line x1="5.45" y1="8.09" x2="2.625" y2="8.09" />
          <line x1="12.45" y1="8.09" x2="15.375" y2="8.09" />
        </g>
        <line class="left-arm" x1="2.625" y1="4.6875" x2="2.625" y2="8.09" />
        <line class="right-arm" x1="15.375" y1="4.6875" x2="15.375" y2="8.09" />
      </g>
      <rect
        class="right-node"
        x="13.3125"
        y="0.5625"
        width="4.125"
        height="4.125"
        rx="1"
      />
      <rect
        class="left-node"
        x="0.5625"
        y="0.5625"
        width="4.125"
        height="4.125"
        rx="1"
      />
    </svg>
  );
};

export const AnimatedFileCodeIcon = (props: IconProps) => (
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
    class={`animated-file-code-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
  >
    <style>{`
      @keyframes file-code-underline-move { 0% { transform: translateX(0); } 100% { transform: translateX(2.75px); } }
      @keyframes file-code-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
      .animated-file-code-icon {
        .underline-1, .underline-2 { transform-origin: 0 14.35px; transition: transform 0.4s ease; }
        .place-rectangle { opacity: 0; }
      }
      .animated-file-code-icon.animating {
        .underline-1 { animation: file-code-underline-move 0.4s ease forwards; }
        .underline-2 { animation: file-code-underline-move 0.4s ease forwards 0.2s; }
        .place-rectangle { animation: file-code-blink 1s step-start infinite 0.4s; }
      }
    `}</style>
    <rect x="0.47" y="0.47" width="17.06" height="11.06" rx="1.5" />
    <path d="M3.375 3.75L6.75 6L3.375 8.25" />
    <line class="underline-1" x1="7.3125" y1="8.25" x2="10.6875" y2="8.25" />
    <line class="underline-2" x1="7.3125" y1="8.25" x2="10.6875" y2="8.25" />
    <rect
      class="place-rectangle"
      x="9.5"
      y="3"
      width="4.5"
      height="6"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

// WAAPI morph (email → paper plane). Ported from wide-email.tsx.
const EMAIL_BODY_A_D =
  'M 17.53125,5.96875 L 17.53125,1.96875 C 17.53125,1.1403 16.8597,0.46875 16.03125,0.46875 L 1.96875,0.46875 C 1.1403,0.46875 0.46875,1.1403 0.46875,1.96875 L 0.46875,5.96875';
const EMAIL_BODY_B_D =
  'M 0.46875,5.96875 L 0.46875,9.96875 C 0.46875,10.7972 1.1403,11.46875 1.96875,11.46875 L 16.03125,11.46875 C 16.8597,11.46875 17.53125,10.6403 17.53125,9.96875 L 17.53125,5.96875';
const EMAIL_FLAP_D = 'M 0.90825,0.90825 L 9,6.75 L 17.09175,0.90825';
const PLANE_A_D =
  'M 10.875,6 L 17.25,0.75 C 17.25,0.75 17.25,0.75 17.25,0.75 L 0.75,1 C 0.75,1 0.75,1 0.75,1 L 2.625,6.125';
const PLANE_B_D =
  'M 2.625,6.125 L 4.5,11.25 C 4.5,11.25 4.5,11.25 4.5,11.25 L 4.5,11.25 C 4.5,11.25 4.5,11.25 4.5,11.25 L 10.875,6';
const PLANE_C_D = 'M 0.75,1 L 4.5,11.25 L 17.25,0.75';
const p = (d: string) => `path('${d}')`;

export const AnimatedEmailIcon = (props: IconProps) => {
  let bodyAEl!: SVGPathElement;
  let bodyBEl!: SVGPathElement;
  let flapEl!: SVGPathElement;
  let prevTrigger = false;
  let anims: Animation[] = [];

  createEffect(() => {
    const trigger = !!props.triggerAnimation;
    if (trigger === prevTrigger) return;
    prevTrigger = trigger;
    if (typeof bodyAEl?.animate !== 'function') return;
    const opts = {
      duration: 400,
      easing: 'ease-in-out',
      fill: 'forwards' as FillMode,
      direction: (trigger ? 'normal' : 'reverse') as PlaybackDirection,
    };
    for (const a of anims) {
      try {
        a.cancel();
      } catch (_) {}
    }
    anims = [
      bodyAEl.animate([{ d: p(EMAIL_BODY_A_D) }, { d: p(PLANE_A_D) }], opts),
      bodyBEl.animate([{ d: p(EMAIL_BODY_B_D) }, { d: p(PLANE_B_D) }], opts),
      flapEl.animate([{ d: p(EMAIL_FLAP_D) }, { d: p(PLANE_C_D) }], opts),
    ];
  });

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
      class={props.class}
    >
      <path ref={bodyAEl} d={EMAIL_BODY_A_D} stroke-linejoin="round" />
      <path ref={bodyBEl} d={EMAIL_BODY_B_D} stroke-linejoin="round" />
      <path ref={flapEl} d={EMAIL_FLAP_D} />
    </svg>
  );
};
