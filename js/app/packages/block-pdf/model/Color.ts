import { z } from 'zod';

export const DEFAULT_COLOR: IColor = { red: 0, green: 0, blue: 0 };

export function hexToRgb(hex: string, alpha: number): IColor {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result)
    return {
      red: parseInt(result[1], 16),
      green: parseInt(result[2], 16),
      blue: parseInt(result[3], 16),
      alpha,
    };
  return DEFAULT_COLOR;
}

export function determineFormat(color: IColor): string {
  return color.red < 100 && color.green < 100 && color.blue > 200
    ? 'underline'
    : color.red > 200 && color.green < 100 && color.blue < 100
      ? 'line-through'
      : 'none';
}

export class Color {
  private red: number;
  private green: number;
  private blue: number;
  private alpha: number;

  constructor(red: number, green: number, blue: number, alpha?: number) {
    this.red = red;
    this.green = green;
    this.blue = blue;
    this.alpha = alpha !== undefined ? alpha : 1;
  }

  public clone(): Color {
    return new Color(this.red, this.green, this.blue, this.alpha);
  }

  public static toObject(this_: Color): IColor {
    return {
      red: this_.red,
      green: this_.green,
      blue: this_.blue,
      alpha: this_.alpha,
    };
  }

  public static getColor(json: {
    red: number;
    green: number;
    blue: number;
    alpha?: number;
  }): Color {
    return new Color(json.red, json.green, json.blue, json.alpha ?? 0.4);
  }

  public static toRgbaString(this_: IColor): string {
    return `rgba(${this_.red}, ${this_.green}, ${this_.blue}, ${this_.alpha})`;
  }

  // @unused
  public static toRgbString(this_: IColor): string {
    return `rgb(${this_.red}, ${this_.green}, ${this_.blue}})`;
  }

  // @unused
  public static rgbToHex(this_: IColor): string {
    let splitRGB = [
      this_.red.toString(16),
      this_.green.toString(16),
      this_.blue.toString(16),
    ];
    splitRGB.forEach(function (part, i) {
      if (part.length === 1) {
        splitRGB[i] = '0' + part;
      }
    });
    return '#' + splitRGB.join('');
  }

  // @unused
  public static average(colors: IColor[]) {
    let redSumOfSquares = 0;
    let greenSumOfSquares = 0;
    let blueSumOfSquares = 0;
    let maxAlpha = 0;

    colors.forEach((c) => {
      redSumOfSquares += c.red ** 2;
      greenSumOfSquares += (c.green || 0) ** 2;
      blueSumOfSquares += (c.blue || 0) ** 2;
      maxAlpha = Math.max(maxAlpha, c.alpha || 0);
    });

    const avgRed = Math.round(Math.sqrt(redSumOfSquares / colors.length));
    const avgGreen = Math.round(Math.sqrt(greenSumOfSquares / colors.length));
    const avgBlue = Math.round(Math.sqrt(blueSumOfSquares / colors.length));
    return new Color(avgRed, avgGreen, avgBlue, maxAlpha);
  }

  /**
   * Checks for equality between two lists of colors ignoring order
   * @unused
   *
   * @param oldColors
   * @param newColors
   */
  public static arrayEquals(oldColors: IColor[], newColors: IColor[]) {
    if (oldColors === newColors) return true;
    if (oldColors.length !== newColors.length) return false;

    const oldColorsStrings = oldColors.map((color) => color.toString()).sort();
    const newColorsStrings = newColors.map((color) => color.toString()).sort();

    for (let i = 0; i < oldColorsStrings.length; i += 1) {
      if (oldColorsStrings[i] !== newColorsStrings[i]) {
        return false;
      }
    }

    return true;
  }
}

export const ColorSchema = z.object({
  red: z.number(),
  green: z.number(),
  blue: z.number(),
  alpha: z.number().optional(),
});

export type IColor = z.infer<typeof ColorSchema>;
