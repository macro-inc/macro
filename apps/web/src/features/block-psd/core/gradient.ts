/**
 * Gradients as the editor makes and changes them: Photoshop's two-color
 * gradients, recoloring an end without losing the stops between, and the
 * names of the styles and color-mixing methods.
 */

import type {
  Gradient,
  GradientKind,
  GradientMethod,
  Rgb,
} from '@core/psd-engine/types';
import { BLACK, WHITE } from './color';

export const GRADIENT_KINDS: { value: GradientKind; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'angle', label: 'Angle' },
  { value: 'reflected', label: 'Reflected' },
  { value: 'diamond', label: 'Diamond' },
];

export const GRADIENT_METHODS: { value: GradientMethod; label: string }[] = [
  { value: 'perceptual', label: 'Perceptual' },
  { value: 'linear', label: 'Linear' },
  { value: 'classic', label: 'Classic' },
  { value: 'smooth', label: 'Smooth' },
];

/** New gradients mix colors as Photoshop's do now. */
export const DEFAULT_GRADIENT_METHOD: GradientMethod = 'perceptual';

/** A two-color gradient from `from` to `to`. */
export function twoColorGradient(
  from: Rgb,
  to: Rgb,
  name = 'Custom',
  method: GradientMethod = DEFAULT_GRADIENT_METHOD
): Gradient {
  return {
    name,
    kind: 'linear',
    angle: 90,
    scale: 1,
    reverse: false,
    dither: false,
    alignWithLayer: true,
    offset: [0, 0],
    smoothness: 1,
    method,
    colors: [
      { location: 0, midpoint: 0.5, color: from },
      { location: 1, midpoint: 0.5, color: to },
    ],
    opacities: [
      { location: 0, midpoint: 0.5, opacity: 1 },
      { location: 1, midpoint: 0.5, opacity: 1 },
    ],
  };
}

/** The color of a gradient's first or last stop. */
export function endColor(gradient: Gradient, end: 'first' | 'last'): Rgb {
  const stops = gradient.colors;
  const stop = end === 'first' ? stops[0] : stops[stops.length - 1];
  return stop?.color ?? (end === 'first' ? BLACK : WHITE);
}

/**
 * The gradient with its first or last color stop recolored; the stops
 * between and every other setting stay.
 */
export function recolorEnd(
  gradient: Gradient,
  end: 'first' | 'last',
  color: Rgb
): Gradient {
  if (gradient.colors.length === 0)
    return {
      ...gradient,
      colors: twoColorGradient(
        end === 'first' ? color : BLACK,
        end === 'last' ? color : WHITE
      ).colors,
    };
  const index = end === 'first' ? 0 : gradient.colors.length - 1;
  return {
    ...gradient,
    colors: gradient.colors.map((stop, i) =>
      i === index ? { ...stop, color } : stop
    ),
  };
}
