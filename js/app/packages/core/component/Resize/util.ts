import type { PanelSizeSpec } from './types';

/**
 * Convert a string to a PanelSizeSpec.
 * @param input a string like "1fr" or "300px" or "25%" or "auto"
 */
export function stringToSizeSpec(input?: string): PanelSizeSpec {
  if (!input) return { kind: 'auto' };

  const inputLc = input.trim().toLowerCase();
  if (inputLc === 'auto') return { kind: 'auto' };

  if (inputLc.endsWith('fr')) {
    const num = parseFloat(inputLc.slice(0, -2));
    if (!Number.isNaN(num) && num > 0) return { kind: 'fr', fr: num };
  }

  if (inputLc.endsWith('%')) {
    const num = parseFloat(inputLc.slice(0, -1));
    if (!Number.isNaN(num)) return { kind: 'percent', percent: num };
  }

  if (inputLc.endsWith('px')) {
    const num = parseFloat(inputLc.slice(0, -2));
    if (!Number.isNaN(num)) return { kind: 'px', px: num };
  }

  return { kind: 'auto' };
}
