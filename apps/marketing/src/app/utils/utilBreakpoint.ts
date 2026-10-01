import { createSignal } from 'solid-js';
import { isServer } from 'solid-js/web';

const point = 1030;
// During build-time prerendering there is no window; assume the desktop
// layout. The client re-renders from scratch with the real viewport.
const initialWidth = isServer ? 1440 : window.innerWidth;
export const [viewportWidth, setViewportWidth] = createSignal(initialWidth);
export const [breakpoint, setBreakpoint] = createSignal(initialWidth < point);

if (!isServer) {
  window.addEventListener('resize', () => {
    setViewportWidth(window.innerWidth);
    if (window.innerWidth >= point) {
      setBreakpoint(false);
    } else {
      setBreakpoint(true);
    }
  });
}

// The phone/desktop cutoff. The .ssg-mobile/.ssg-desktop media queries in
// src/app/main/index.css (and the prerenderer's critical CSS) hard-code the
// same 700px; media queries can't read a JS constant, so change both together.
export const MOBILE_CUTOFF = 700;
export const isMobileViewport = () => viewportWidth() < MOBILE_CUTOFF;
