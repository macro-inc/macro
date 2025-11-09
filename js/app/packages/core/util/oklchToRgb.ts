// Apply sRGB gamma correction
const gammaCorrectChannel = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const toHex = (x: number) => x.toString(16).padStart(2, '0');

/**
 * Convert an OKLCH color string to an [R, G, B] tuple.
 * @param oklch - The OKLCH color string to convert.
 * @param options - Optional conversion options.
 * @param options.gammaCorrect - Whether to apply sRGB gamma correction.
 * @param options.normalized - Whether to return normalized values [0, 1] rather
 *     than [0, 255].
 */
export function oklchToRgb(
  oklch: string,
  options: {
    gammaCorrect?: boolean;
    normalized?: boolean;
  } = { gammaCorrect: true, normalized: false }
) {
  const { gammaCorrect, normalized } = options;

  let map = oklch
    .match(/oklch\(([^)]+)\)/)?.[1]
    .split(/\s+/)
    .map((val) => {
      let isPercentage = val.includes('%');
      let num = parseFloat(val);
      return isPercentage ? num / 100 : num;
    });
  if (!map) return;
  let [L, C, h] = map;
  h = (h * Math.PI) / 180; // Convert degrees to radians

  // Convert OKLCH to OKLab
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  // Convert OKLab to linear RGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b_ = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  if (gammaCorrect) {
    r = gammaCorrectChannel(r);
    g = gammaCorrectChannel(g);
    b_ = gammaCorrectChannel(b_);
  }

  r = clamp01(r);
  g = clamp01(g);
  b_ = clamp01(b_);

  if (normalized) {
    return [r, g, b_];
  } else {
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b_ * 255)];
  }
}

export function oklchToHex(oklch: string) {
  const rgb = oklchToRgb(oklch, { gammaCorrect: true, normalized: false });
  if (!rgb) return;
  const [r, g, b] = rgb;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
