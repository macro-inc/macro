import { DEFAULT_TAG_COLOR } from '@property/tags/tagColors';

export type GithubLabelColors = {
  color: string;
  background: string;
  border: string;
};

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return undefined;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Hue in degrees, saturation and lightness in percent. */
function toHsl([r, g, b]: Rgb): Rgb {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness * 100];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [hue, saturation * 100, lightness * 100];
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The colors GitHub draws a label with, from its hex color. Dark themes tint
 * the background and lighten dark label colors until the text is readable;
 * light themes fill with the label color and pick black or white text.
 */
export function githubLabelColors(
  hex: string | undefined,
  mode: 'light' | 'dark'
): GithubLabelColors {
  const rgb = (hex && parseHex(hex)) || (parseHex(DEFAULT_TAG_COLOR) as Rgb);
  const [r, g, b] = rgb;
  const [h, s, l] = toHsl(rgb);
  const [hue, saturation, lightness] = [round(h), round(s), round(l)];
  const perceived = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;

  if (mode === 'dark') {
    const lightenBy = Math.max(0, 0.6 - perceived) * 100;
    const text = `${hue} ${saturation}% ${round(Math.min(100, lightness + lightenBy))}%`;
    return {
      color: `hsl(${text})`,
      background: `rgb(${r} ${g} ${b} / 0.18)`,
      border: `hsl(${text} / 0.3)`,
    };
  }

  return {
    color: perceived < 0.453 ? '#ffffff' : '#000000',
    background: `rgb(${r} ${g} ${b})`,
    border:
      perceived > 0.96
        ? `hsl(${hue} ${saturation}% ${round(Math.max(0, lightness - 25))}%)`
        : 'transparent',
  };
}
