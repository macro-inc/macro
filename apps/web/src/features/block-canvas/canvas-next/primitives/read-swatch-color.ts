import { normalizePickerColor } from '@ui/utils/color';

/** Read an existing CSS palette swatch only when opening its picker. The browser
 * resolves theme colors; the picker itself only receives an sRGB hex value. */
export function readSwatchColor(
  element: HTMLElement,
  fallback = '#000000'
): string {
  try {
    const color = getComputedStyle(element).backgroundColor;
    const parsed = normalizePickerColor(color);
    if (parsed) return parsed;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const channels = Array.from(context.getImageData(0, 0, 1, 1).data);
    if (channels[3] === 255) channels.pop();
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return fallback;
  }
}
