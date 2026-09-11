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
 * Action timing is owned by the control, independently of this visual effect.
 */
export function pressPulse(el: HTMLElement) {
  el.setAttribute('data-press-pulse', '');
}
