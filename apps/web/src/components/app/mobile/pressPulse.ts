declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      pressPulse: true;
    }
  }
}

/**
 * Press feedback for floating mobile chrome buttons (`[data-press-pulse]`
 * in index.css): pointer-down eases the button to its on-state and holds
 * it; release bounces it back. Marks the element and manages
 * `data-pressed`. Fire the button's action from `onClick` (release), not
 * pointer-down.
 */
export function pressPulse(el: HTMLElement) {
  el.setAttribute('data-press-pulse', '');
  const press = () => el.setAttribute('data-pressed', '');
  const release = () => el.removeAttribute('data-pressed');
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release);
}
