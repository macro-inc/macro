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
        /* The .animating class is toggled by the triggerAnimation prop; callers
           drive it differently — held for the duration of hover in the desktop
           sidebar (SidebarActionButton etc.), and pulsed for a fixed duration on
           onPointerDown/tap in the mobile dock (MobileDockButton). While
           .animating is set, the offset/leaning hash resolves into a regular hash
           and stays there: horizontals slide to horizontally-centered
           (translateX), verticals straighten to fully vertical by morphing their
           path 'd'. It eases back when .animating clears. Morphing 'd' (rather
           than skewX) avoids shearing the round caps and keeps the stroke scaling
           normally with icon size. */
        .animated-channel-icon .channel-h {
          transition: transform 0.35s ease-in-out;
        }
        /* Browser support for the .channel-v / .channel-v-* path morph below
           (via 'transition: d'): Chrome/Edge >=52/79 and Firefox >=97, but NOT
           Safari/WebKit — including the macOS Tauri WKWebView — where the 'd'
           property parses but has no effect, so the verticals won't straighten
           there (the translateX horizontals still animate). A WebKit fallback
           (SMIL or JS morph) is TODO in a separate PR covering the other
           animating icons too. */
        .animated-channel-icon .channel-v {
          transition: d 0.35s ease-in-out;
        }
        .animated-channel-icon.animating .channel-h-top {
          transform: translateX(-1px);
        }
        .animated-channel-icon.animating .channel-h-bottom {
          transform: translateX(1px);
        }
        .animated-channel-icon.animating .channel-v-left {
          d: path("M9 15.5L9 0.5");
        }
        .animated-channel-icon.animating .channel-v-right {
          d: path("M15 15.5L15 0.5");
        }
      `}</style>
      <path class="channel-h channel-h-top" d="M2 5H24" />
      <path class="channel-h channel-h-bottom" d="M0 11H22" />
      <path class="channel-v channel-v-left" d="M6.5 15.5L11.5 0.5" />
      <path class="channel-v channel-v-right" d="M12.5 15.5L17.5 0.5" />
    </svg>
  );
};
