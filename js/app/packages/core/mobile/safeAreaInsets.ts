import { isIOS } from '@solid-primitives/platform';

let cachedTop: number | null = null;
window.addEventListener('resize', () => {
  cachedTop = null;
});

export function getSafeAreaInsetTop(): number {
  if (!isIOS) return 0;
  if (cachedTop !== null) return cachedTop;
  const el = document.createElement('div');
  el.style.paddingTop = 'env(safe-area-inset-top, 0px)';
  document.body.appendChild(el);
  cachedTop = Number.parseFloat(getComputedStyle(el).paddingTop) || 0;
  el.remove();
  return cachedTop;
}
