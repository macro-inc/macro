export type PickerColor = {
  /** Hue in degrees; saturation, value, and alpha are in [0, 1]. */
  h: number;
  s: number;
  v: number;
  a: number;
};

const clamp = (value: number, max = 1) => Math.min(max, Math.max(0, value));

function fromRgb(r: number, g: number, b: number, a: number): PickerColor {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return {
    h: (hue * 60 + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max / 255,
    a,
  };
}

function channel(value: string, max: number): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)) return;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return;
  return clamp(value.endsWith('%') ? (number * max) / 100 : number, max);
}

/** Only hex and RGB are accepted. CSS variables and other spaces are host concerns. */
export function parsePickerColor(value: string): PickerColor | undefined {
  const input = value.trim().toLowerCase();
  if (input === 'transparent' || input === 'none') return fromRgb(0, 0, 0, 0);
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(input)) {
    const hex =
      input.length <= 5
        ? [...input.slice(1)].map((digit) => digit + digit).join('')
        : input.slice(1);
    return fromRgb(
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
    );
  }
  const rgb = /^rgba?\((.*)\)$/.exec(input);
  if (!rgb) return;
  const body = rgb[1].trim();
  const parts = body.includes(',')
    ? body.split(',').map((part) => part.trim())
    : body.split(/\s*\/\s*|\s+/);
  if (parts.length !== 3 && parts.length !== 4) return;
  const r = channel(parts[0], 255);
  const g = channel(parts[1], 255);
  const b = channel(parts[2], 255);
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (r === undefined || g === undefined || b === undefined || a === undefined)
    return;
  return fromRgb(r, g, b, a);
}

export function pickerColorToHex(color: PickerColor): string {
  const hue = (((color.h % 360) + 360) % 360) / 60;
  const chroma = clamp(color.v) * clamp(color.s);
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = clamp(color.v) - chroma;
  const rgb =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const byte = (value: number) =>
    Math.round(clamp(value) * 255 + Number.EPSILON * 255)
      .toString(16)
      .padStart(2, '0');
  const hex = rgb.map((value) => byte(value + m)).join('');
  const alpha = byte(color.a);
  return `#${hex}${alpha === 'ff' ? '' : alpha}`;
}

export function normalizePickerColor(value: string): string | undefined {
  const color = parsePickerColor(value);
  return color && pickerColorToHex(color);
}

/** RGB cannot encode hue for gray, or hue/saturation for black. Keep the user's choice. */
export function preservePickerHue(
  next: PickerColor,
  previous: PickerColor
): PickerColor {
  if (next.v === 0) return { ...next, h: previous.h, s: previous.s };
  if (next.s === 0) return { ...next, h: previous.h };
  return next;
}
