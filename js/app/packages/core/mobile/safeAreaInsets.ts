import { isIOS } from '@solid-primitives/platform';

type SafeAreaInsetSide = 'top' | 'right' | 'bottom' | 'left';

const cache: Record<SafeAreaInsetSide, number | null> = {
  top: null,
  right: null,
  bottom: null,
  left: null,
};

window.addEventListener('resize', () => {
  cache.top = null;
  cache.right = null;
  cache.bottom = null;
  cache.left = null;
});

export function getSafeAreaInset(side: SafeAreaInsetSide): number {
  if (!isIOS) return 0;
  if (cache[side] !== null) return cache[side];
  const el = document.createElement('div');
  el.style.setProperty(`padding-${side}`, `env(safe-area-inset-${side}, 0px)`);
  document.body.appendChild(el);
  cache[side] =
    Number.parseFloat(
      getComputedStyle(el).getPropertyValue(`padding-${side}`)
    ) || 0;
  el.remove();
  return cache[side];
}
