import { createUniqueId } from 'solid-js';

export const AnimatedChannelIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
  // Unique clipPath id so multiple instances on a page don't collide.
  const clipId = `channel-clip-${createUniqueId()}`;

  return (
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
      overflow="hidden"
      class={`animated-channel-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Channel icon</title>*/}
      <style>{`
        @keyframes channel-zip-h-top {
          0%, 15% { transform: translate(-26px, 0); }
          100%    { transform: translate(0, 0); }
        }
        @keyframes channel-zip-h-bottom {
          0%, 15% { transform: translate(26px, 0); }
          100%    { transform: translate(0, 0); }
        }
        @keyframes channel-zip-v-left {
          0%, 15% { transform: translate(-8px, 24px); }
          100%    { transform: translate(0, 0); }
        }
        @keyframes channel-zip-v-right {
          0%, 15% { transform: translate(8px, -24px); }
          100%    { transform: translate(0, 0); }
        }
        /* easeOutBack: the 15% -> 100% segment zips in then overshoots past rest and
           settles. The 0% -> 15% segment holds (both keyframes share the start offset). */
        .animated-channel-icon.animating .channel-h-top {
          animation: channel-zip-h-top 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animated-channel-icon.animating .channel-h-bottom {
          animation: channel-zip-h-bottom 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animated-channel-icon.animating .channel-v-left {
          animation: channel-zip-v-left 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animated-channel-icon.animating .channel-v-right {
          animation: channel-zip-v-right 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
      <clipPath id={clipId}>
        <rect x="0" y="-4" width="24" height="24" />
      </clipPath>
      <g clip-path={`url(#${clipId})`}>
        {/* Horizontals shortened ~1u on the edge-touching end so the round caps stay
            inside the clip box at rest (M2 5H24 -> H23, M0 11H22 -> M1). */}
        <path class="channel-h channel-h-top" d="M2 5H23" />
        <path class="channel-h channel-h-bottom" d="M1 11H22" />
        <path class="channel-v channel-v-left" d="M6.5 15.5L11.5 0.5" />
        <path class="channel-v channel-v-right" d="M12.5 15.5L17.5 0.5" />
      </g>
    </svg>
  );
};
