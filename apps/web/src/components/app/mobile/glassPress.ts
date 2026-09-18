import { isTouchDevice } from '@core/mobile/isTouchDevice';

const GROUP =
  '[data-mobile-dock-island], [data-header-island], [data-slot="button-group"].glass';
const CONTROL =
  'button, a, [role="button"], [role="tab"], [data-header-island]';
const DISABLED = ':disabled, [data-disabled], [aria-disabled="true"]';

/** Round controls retain their 20% press; wide surfaces grow at most 3px per edge. */
export function glassPressGeometry(width: number, height: number) {
  const outset = Math.min(3, width * 0.15, height * 0.15);
  return {
    outset,
    round: width <= height * 1.15,
    scale: 1.2,
  };
}

/**
 * Automatically animate glass/island controls and their enclosing groups,
 * including controls rendered through portals. CSS owns the persistent paint
 * layers and their release transitions; controls own action timing.
 */
export function installGlassPress() {
  let pressed:
    | { element: HTMLElement; pointerId: number; bounds: DOMRect }
    | undefined;
  const release = () => {
    if (!pressed) return;
    pressed.element.removeAttribute('data-glass-press');
    // Keep the last tap geometry for the fading shimmer. These values belong
    // to the element, so removing it needs no timer or retained reference.
    pressed = undefined;
  };
  const down = (event: PointerEvent) => {
    if (!isTouchDevice() || !event.isPrimary || event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>(CONTROL);
    if (!control || control.closest(DISABLED)) return;
    const group = control.closest<HTMLElement>(GROUP);
    if (!group && !control.matches('.glass, .island, [class~="touch:island"]'))
      return;
    release();
    const element = group ?? control;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height) return;
    const geometry = glassPressGeometry(width, height);
    element.style.setProperty('--press-outset', `${geometry.outset}px`);
    element.style.setProperty('--press-scale', String(geometry.scale));
    // Convert the tap into local coordinates, including a partially scaled
    // round control when a second press interrupts its release.
    element.style.setProperty(
      '--press-x',
      `${Math.max(0, Math.min(width, ((event.clientX - bounds.left) * width) / bounds.width))}px`
    );
    element.style.setProperty(
      '--press-y',
      `${Math.max(0, Math.min(height, ((event.clientY - bounds.top) * height) / bounds.height))}px`
    );
    element.style.setProperty(
      '--press-shimmer-size',
      `${Math.max(100, Math.min(260, height * 3))}px`
    );
    element.setAttribute('data-glass-press', geometry.round ? 'round' : 'wide');
    pressed = { element, pointerId: event.pointerId, bounds };
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId === pressed?.pointerId) release();
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pressed?.pointerId || !pressed) return;
    const { bounds } = pressed;
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      release();
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  document.addEventListener('pointermove', move, true);
  window.addEventListener('blur', release);
  return () => {
    release();
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', up, true);
    document.removeEventListener('pointermove', move, true);
    window.removeEventListener('blur', release);
  };
}
