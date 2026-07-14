// @ts-ignore vite understands, TS does not (don't try switching the module standard)

import { oklchToHex } from '@core/util/oklchToRgb';
import { withRecall } from '@core/util/withRecall';
import colors from 'tailwindcss/colors';
import { type CanvasNode, StyleSchema } from '../model/CanvasModel';
import type { Color, Hex } from './color';
import { clamp } from './math';

export const allStyleProps = Object.keys(StyleSchema.shape);

function validateHex(hex: Hex | string): hex is Hex {
  hex = hex.replace('#', '');
  if (/^[0-9A-Fa-f]{3}$/.test(hex)) return true;
  if (/^[0-9A-Fa-f]{6}$/.test(hex)) return true;
  if (/^[0-9A-Fa-f]{8}$/.test(hex)) return true;
  return false;
}

const getHex = withRecall(oklchToHex);

export function getTailwindColor(colorClass: string): Color {
  const [colorName, shade] = colorClass.split('-');
  if (!shade) {
    if (colorName === 'white') return '#ffffff';
    if (colorName === 'transparent') return 'transparent';
  }
  // @ts-ignore
  const oklch = colors[colorName]?.[shade];
  // hex colors are sometimes, rarely used
  if (oklch.startsWith('#')) return oklch;
  if (!oklch) return 'transparent';
  const hex = getHex(oklch);
  if (!hex) return 'transparent';
  if (!validateHex(hex)) return 'transparent';
  return hex;
}

/**
 * Adds opacity to a hex color or returns 'transparent'
 * @param color - Hex color string (3, 6, or 8 digits) or 'transparent'
 * @param opacity - Number between 0 and 100
 * @returns Hex color string with opacity
 * @throws Error if color format is invalid or opacity is out of range
 */
export function opacity(color: Color, opacity: number): string {
  if (color === 'transparent') return 'transparent';

  const o = clamp(opacity, 0, 100) / 100;
  const a = Math.round(255 * o);

  const col = color.replace('#', '');

  let hex: string;
  if (col.length === 3) {
    hex = col
      .split('')
      .map((char) => char + char)
      .join('');
  } else if (col.length === 6) {
    hex = col;
  } else if (col.length === 8) {
    hex = col.substring(0, 6);
  } else {
    throw new Error('Invalid color format. Use 3, 6, or 8-digit hex color.');
  }

  // validate hex
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    // throw new Error('Invalid hex color characters');
    return 'transparent';
  }

  const alphaHex = a.toString(16).padStart(2, '0');
  return `#${hex}${alphaHex} `;
}

export function getBorderRadius(node: CanvasNode) {
  if (!node.style?.cornerRadius) return '0px';
  if (node.style?.cornerRadius >= 100) {
    return 'calc(infinity * 1px)';
  }
  return node.style.cornerRadius + 'px';
}

export const LineEndStyles = ['None', 'Caret', 'Triangle', 'Circle'];

export function getLineEndStyle(style: number) {
  if (style >= 0 && style < LineEndStyles.length) {
    return LineEndStyles[style];
  } else {
    return LineEndStyles[0];
  }
}

export function getTextNodeHeight(fontSize: any): number {
  return 2.25 * (fontSize ?? 24);
}
