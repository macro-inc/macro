type SafeAreaInsetSide = 'top' | 'right' | 'bottom' | 'left';

export function getSafeAreaInset(side: SafeAreaInsetSide): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    `--safe-${side}`
  );
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}
