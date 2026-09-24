import type { Appearance } from './model';

export const resolveAppearance = (appearance: Appearance) => ({
  ...appearance,
  strokeWidth: appearance.strokeWidth ?? 2,
  opacity: appearance.opacity ?? 1,
  cornerRadius: appearance.cornerRadius ?? 0,
});

export function validAppearance(value: unknown): value is Appearance {
  if (
    !value ||
    typeof value !== 'object' ||
    !('fill' in value) ||
    typeof value.fill !== 'string' ||
    !('stroke' in value) ||
    typeof value.stroke !== 'string'
  )
    return false;
  for (const key of ['strokeWidth', 'opacity', 'cornerRadius'] as const) {
    if (!(key in value)) continue;
    const number = value[key as keyof typeof value];
    if (number === undefined) continue;
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < 0 ||
      (key === 'opacity' && number > 1)
    )
      return false;
  }
  return true;
}
