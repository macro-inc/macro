/**
 * Convert OKLCH to linear sRGB (for Three.js which expects linear color space)
 * OKLCH: L (0-1), C (0-0.4+), H (0-360)
 */
export function oklchToLinearRgb(
  l: number,
  c: number,
  h: number
): { r: number; g: number; b: number } {
  // Convert hue to radians
  const hRad = (h * Math.PI) / 180;

  // OKLCH to OKLab
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  // OKLab to linear sRGB
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r_linear = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g_linear = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b_linear = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return {
    r: Math.max(0, Math.min(1, r_linear)),
    g: Math.max(0, Math.min(1, g_linear)),
    b: Math.max(0, Math.min(1, b_linear)),
  };
}

/**
 * Convert OKLCH to sRGB (gamma corrected)
 * OKLCH: L (0-1), C (0-0.4+), H (0-360)
 */
export function oklchToRgb(
  l: number,
  c: number,
  h: number
): { r: number; g: number; b: number } {
  const linear = oklchToLinearRgb(l, c, h);

  // Linear to sRGB gamma correction
  const toSrgb = (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  };

  return {
    r: toSrgb(linear.r),
    g: toSrgb(linear.g),
    b: toSrgb(linear.b),
  };
}
