declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      pressPulse: true;
    }
  }
}

/**
 * Marks controls for the app's delegated glass press effect. The enclosing
 * island owns the surface expansion, icon growth, and tap-centered sheen.
 * Fire the button's action from `onClick` (release), not pointer-down.
 */
export function pressPulse(el: HTMLElement) {
  el.setAttribute('data-press-pulse', '');
}
