export type RGBAColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type ColorValueHex = `#${string}`;

const HEX_COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export function hexToRGBA(hex: string): RGBAColor {
  var result = HEX_COLOR_REGEX.exec(hex);
  if (!result) {
    throw new Error('Invalid hex color');
  }
  const r = parseInt(result[0], 16);
  const g = parseInt(result[1], 16);
  const b = parseInt(result[2], 16);
  return { r, g, b, a: 1 };
}

export function rgbaToHex(rgba: RGBAColor): ColorValueHex {
  return `#${[rgba.r, rgba.g, rgba.b]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function stringAsHex(hex: string): ColorValueHex {
  if (HEX_COLOR_REGEX.test(hex)) {
    return hex as ColorValueHex;
  }

  throw new Error('Invalid hex color');
}
