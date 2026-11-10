/** Interaction feedback for the original Macro icon family. No action is delayed. */
const CONTROL =
  'button, a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const EXCLUDED =
  '[data-icon-motion="none"], [disabled], [aria-disabled="true"], [aria-busy="true"], [inert], .animate-spin, .animate-pulse';
const STATE_ICON =
  /^(caret|caret-double|arrow|arrows|spinner|circle|dot|check|minus|warning|x)(-|$)/;
const STILL_ICON = /^(sparkle)(-|$)/;

function controlAt(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(CONTROL)
    : null;
}

function actionIcon(control: HTMLElement) {
  if (control.closest(EXCLUDED) || control.matches(':disabled')) return;
  for (const svg of control.querySelectorAll<SVGSVGElement>(
    'svg[data-macro-icon]'
  )) {
    if (svg.closest(CONTROL) !== control || svg.closest(EXCLUDED)) continue;
    const name = svg.dataset.macroIcon?.replace(/-(fill|bold)$/, '') ?? '';
    if (STATE_ICON.test(name) || STILL_ICON.test(name)) continue;
    const target = svg.closest<HTMLElement>('[data-icon-motion-target]') ?? svg;
    const { width, height } = target.getBoundingClientRect();
    // Illustrations and hidden glyphs are not interaction feedback.
    if (!width || !height || width > 32 || height > 32) continue;
    return { target, name };
  }
}

function frames(name: string): Keyframe[] {
  let rotate = '0deg';
  let translate = '0 0';
  if (/^gear/.test(name)) rotate = '24deg';
  else if (/^(bell|phone)/.test(name)) rotate = '-10deg';
  else if (/^(envelope|folder|paperclip)/.test(name)) rotate = '-6deg';
  else if (/^plus/.test(name)) rotate = '15deg';
  else if (/^(share|upload|paper-plane)/.test(name)) translate = '0 -2px';
  else if (/^magnifying-glass/.test(name)) translate = '1px -1px';
  return [
    { scale: '1', rotate: '0deg', translate: '0 0', transformOrigin: 'center' },
    {
      scale: '0.88',
      rotate,
      translate,
      offset: 0.3,
      transformOrigin: 'center',
    },
    {
      scale: '1.04',
      rotate: '0deg',
      translate: '0 0',
      offset: 0.68,
      transformOrigin: 'center',
    },
    { scale: '1', rotate: '0deg', translate: '0 0', transformOrigin: 'center' },
  ];
}

/** Install once on the app shell; delegation also covers menus rendered in portals. */
export function installIconMotion() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<Element, Animation>();

  function play(control: HTMLElement) {
    if (reducedMotion.matches || !control.isConnected) return;
    const icon = actionIcon(control);
    if (!icon || typeof icon.target.animate !== 'function') return;
    animations.get(icon.target)?.cancel();
    // Individual transform properties preserve transforms used for layout/state.
    const animation = icon.target.animate(frames(icon.name), {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
    });
    animations.set(icon.target, animation);
    const release = () => {
      if (animations.get(icon.target) === animation)
        animations.delete(icon.target);
    };
    animation.onfinish = release;
    animation.oncancel = release;
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || event.isPrimary === false) return;
    const control = controlAt(event.target);
    if (control) play(control);
  }

  function onClick(event: MouseEvent) {
    // Pointer activation already played on press. Keyboard/AT clicks have no detail.
    if (event.detail !== 0) return;
    const control = controlAt(event.target);
    if (control) play(control);
  }

  function stop() {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  reducedMotion.addEventListener('change', stop);
  return () => {
    stop();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    reducedMotion.removeEventListener('change', stop);
  };
}
