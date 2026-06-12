// One-shot "expand & reconverge" animation, driven by the .animating class (toggled by
// the triggerAnimation prop, same as the other animated icons). Each line moves radially
// outward from the icon's center, then eases back to rest with a slight overshoot — the
// hash briefly expands and reconverges.
//
// Outward directions (radial from center ~(12, 8), so the hash opens up symmetrically):
//   channel-h-top    up      (top bar separates upward)
//   channel-h-bottom down    (bottom bar separates downward)
//   channel-v-left   left    (left bar separates leftward)
//   channel-v-right  right   (right bar separates rightward)
//
// Built on `transform` (not `d` morphing), so unlike the old version it animates in
// Safari/WebKit too (incl. the macOS Tauri WKWebView).

export const AnimatedChannelIcon = (props: {
  triggerAnimation?: boolean;
  class?: string;
}) => {
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
      overflow="visible"
      class={`animated-channel-icon ${props.triggerAnimation ? 'animating' : ''} ${props.class ?? ''}`}
    >
      {/*<title>Channel icon</title>*/}
      <style>{`
        /* Each line eases out to its peak (ease-out), then reconverges with a slight
           overshoot past rest before settling (easeOutBack). */
        @keyframes channel-expand-up {
          0%   { transform: translate(0, 0); animation-timing-function: ease-out; }
          45%  { transform: translate(0, -2px); animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
          100% { transform: translate(0, 0); }
        }
        @keyframes channel-expand-down {
          0%   { transform: translate(0, 0); animation-timing-function: ease-out; }
          45%  { transform: translate(0, 2px); animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
          100% { transform: translate(0, 0); }
        }
        @keyframes channel-expand-left {
          0%   { transform: translate(0, 0); animation-timing-function: ease-out; }
          45%  { transform: translate(-2px, 0); animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
          100% { transform: translate(0, 0); }
        }
        @keyframes channel-expand-right {
          0%   { transform: translate(0, 0); animation-timing-function: ease-out; }
          45%  { transform: translate(2px, 0); animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
          100% { transform: translate(0, 0); }
        }
        .animated-channel-icon.animating .channel-h-top {
          animation: channel-expand-up 0.625s forwards;
        }
        .animated-channel-icon.animating .channel-h-bottom {
          animation: channel-expand-down 0.625s forwards;
        }
        .animated-channel-icon.animating .channel-v-left {
          animation: channel-expand-left 0.625s forwards;
        }
        .animated-channel-icon.animating .channel-v-right {
          animation: channel-expand-right 0.625s forwards;
        }
      `}</style>
      <path class="channel-h channel-h-top" d="M2 5H24" />
      <path class="channel-h channel-h-bottom" d="M0 11H22" />
      <path class="channel-v channel-v-left" d="M6.5 15.5L11.5 0.5" />
      <path class="channel-v channel-v-right" d="M12.5 15.5L17.5 0.5" />
    </svg>
  );
};
