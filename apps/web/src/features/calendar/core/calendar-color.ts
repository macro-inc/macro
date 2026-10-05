import Color from 'colorjs.io';

export type CalendarColor = {
  hue: number;
  saturation: number;
  brightness: number;
};

/** The picker uses HSV so the field maps directly to saturation and brightness. */
export function parseCalendarColor(value: string): CalendarColor {
  const [h, s, l] = new Color(value).to('hsl').coords;
  const lightness = l / 100;
  const brightness = lightness + (s / 100) * Math.min(lightness, 1 - lightness);
  return {
    hue: Number.isFinite(h) ? h : 0,
    saturation: brightness === 0 ? 0 : 2 * (1 - lightness / brightness),
    brightness,
  };
}

export function calendarColorHex(color: CalendarColor): string {
  const lightness = color.brightness * (1 - color.saturation / 2);
  const saturation =
    lightness === 0 || lightness === 1
      ? 0
      : (color.brightness - lightness) / Math.min(lightness, 1 - lightness);
  return new Color('hsl', [color.hue, saturation * 100, lightness * 100])
    .to('srgb')
    .toString({ format: 'hex', collapse: false });
}

export function normalizeCalendarHex(value: string): string | undefined {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`.toLowerCase();
}
