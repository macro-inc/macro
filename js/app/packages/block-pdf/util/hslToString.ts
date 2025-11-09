export type HSL = { h: number; s: number; l: number; a: 0 | 1 };
export function hslToString({ h, s, l, a }: HSL) {
  return `hsl(${h}, ${s * 100}%, ${l * 100}%, ${a * 100}%)`;
}

// https://stackoverflow.com/questions/36721830/convert-hsl-to-rgb-and-hex
export function hslToHex({ h, s, l }: HSL): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0'); // convert to Hex and prefix "0" if needed
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
