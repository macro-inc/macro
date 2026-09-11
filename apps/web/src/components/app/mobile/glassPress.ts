import { isTouchDevice } from '@core/mobile/isTouchDevice';

const GROUP =
  '[data-mobile-dock-island], [data-header-island], [data-slot="button-group"].glass';
const CONTROL =
  'button, a, [role="button"], [role="tab"], [data-press-pulse], [data-header-island]';
const DISABLED = ':disabled, [data-disabled], [aria-disabled="true"]';

/** Round controls retain their 30% press; wide surfaces grow at most 3px per edge. */
export function glassPressGeometry(width: number, height: number) {
  const outset = Math.min(3, width * 0.15, height * 0.15);
  return {
    outset,
    round: width <= height * 1.15,
    scale: 1.3,
  };
}

/** Delegate to the outer material, including controls rendered through portals. */
export function installGlassPress() {
  let pressed:
    | { element: HTMLElement; pointerId: number; bounds: DOMRect }
    | undefined;
  const resets = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const reset = (element: HTMLElement) => {
    element.removeAttribute('data-glass-press');
    element.removeAttribute('data-glass-pressed');
    element.querySelector(':scope > [data-glass-shimmer]')?.remove();
    for (const name of [
      'outset',
      'scale',
      'radius',
      'fill',
      'blur',
      'shadow',
      'x',
      'y',
      'shimmer-size',
    ]) {
      element.style.removeProperty(`--press-${name}`);
    }
    resets.delete(element);
  };
  const release = () => {
    if (!pressed) return;
    const element = pressed.element;
    element.removeAttribute('data-glass-pressed');
    resets.set(
      element,
      setTimeout(() => reset(element), 320)
    );
    pressed = undefined;
  };
  const down = (event: PointerEvent) => {
    if (!isTouchDevice() || !event.isPrimary || event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>(CONTROL);
    if (!control || control.closest(DISABLED)) return;
    const group = control.closest<HTMLElement>(GROUP);
    if (
      !group &&
      !control.matches(
        '.glass, .island, [class~="touch:island"], [data-press-pulse]'
      )
    )
      return;
    release();
    const element = group ?? control;
    const pendingReset = resets.get(element);
    if (pendingReset) clearTimeout(pendingReset);
    resets.delete(element);
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
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
    if (!element.hasAttribute('data-glass-press')) {
      const style = getComputedStyle(element);
      element.style.setProperty(
        '--press-radius',
        `${Math.min(parseFloat(style.borderTopLeftRadius) || 0, bounds.height / 2, bounds.width / 2)}px`
      );
      element.style.setProperty('--press-fill', style.backgroundColor);
      element.style.setProperty('--press-blur', style.backdropFilter);
      element.style.setProperty('--press-shadow', style.boxShadow);
    }
    element.setAttribute('data-glass-press', geometry.round ? 'round' : 'wide');
    let shimmer = element.querySelector<HTMLElement>(
      ':scope > [data-glass-shimmer]'
    );
    if (!shimmer) {
      shimmer = document.createElement('span');
      shimmer.setAttribute('data-glass-shimmer', '');
      shimmer.setAttribute('aria-hidden', 'true');
      element.append(shimmer);
    }
    // Establish the unpressed pseudo-element before starting its transition.
    getComputedStyle(element, '::after').inset;
    getComputedStyle(shimmer, '::before').transform;
    element.setAttribute('data-glass-pressed', '');
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
    for (const [element, timer] of resets) {
      clearTimeout(timer);
      reset(element);
    }
  };
}
