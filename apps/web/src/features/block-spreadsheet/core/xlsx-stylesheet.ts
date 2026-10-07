import type { ConditionalStyle } from '@macro-inc/spreadsheet/sheet-rules';
import { strFromU8 } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import {
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCellStyle,
} from './spreadsheet-document';
import { readNumberFormat } from './xlsx-styles';

/** Excel's legacy 64-colour palette, used by `indexed` colours. */
const INDEXED_COLORS = `000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF
000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 800000 008000 000080 808000
800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF
000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99
99CCFF FF99CC CC99FF FFCC99 3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696
003366 339966 003300 333300 993300 993366 333399 333333`.split(/\s+/);

/** ECMA-376 built-in formats, using Excel's en-US display for locale formats. */
const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  5: '"$"#,##0_);\\("$"#,##0\\)',
  6: '"$"#,##0_);[Red]\\("$"#,##0\\)',
  7: '"$"#,##0.00_);\\("$"#,##0.00\\)',
  8: '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  41: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  42: '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  43: '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};

type Attributes = Record<string, string>;
type ColorSpec = Attributes | undefined;
type Edge = { style?: string; color?: ColorSpec };
type Font = {
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  strike?: boolean;
  size?: number;
  name?: string;
  color?: ColorSpec;
  effects?: boolean;
};
type Fill = {
  pattern?: string;
  fg?: ColorSpec;
  bg?: ColorSpec;
  gradient?: ColorSpec[];
};
/** A differential format, as conditional formatting rules apply. */
type Dxf = {
  font?: Font;
  fill?: Fill;
  numberFormat?: string;
};
type Xf = {
  numFmtId: number;
  fontId: number;
  fillId: number;
  borderId: number;
  alignment?: Attributes;
};

function attributes(node: SaxesTagNS): Attributes {
  const result: Attributes = {};
  for (const attribute of Object.values(node.attributes))
    result[attribute.local] = attribute.value;
  return result;
}

const flag = (value: Attributes) =>
  value.val === undefined || (value.val !== '0' && value.val !== 'false');

/** One element inside a `<dxf>`: font, fill and number format. */
function readDifferential(
  dxf: Dxf,
  local: string,
  parent: string | undefined,
  value: Attributes
) {
  if (local === 'font') dxf.font = {};
  else if (local === 'fill') dxf.fill = {};
  else if (local === 'numFmt' && parent === 'dxf')
    dxf.numberFormat = value.formatCode;
  else if (dxf.font && parent === 'font') {
    if (local === 'b') dxf.font.bold = flag(value);
    else if (local === 'i') dxf.font.italic = flag(value);
    else if (local === 'strike') dxf.font.strike = flag(value);
    else if (local === 'u') dxf.font.underline = value.val ?? 'single';
    else if (local === 'color') dxf.font.color = value;
  } else if (dxf.fill && local === 'patternFill')
    dxf.fill.pattern = value.patternType;
  else if (dxf.fill && parent === 'patternFill') {
    if (local === 'fgColor') dxf.fill.fg = value;
    else if (local === 'bgColor') dxf.fill.bg = value;
  }
}

/** Theme colours in SpreadsheetML index order (light/dark pairs swapped). */
export function readXlsxTheme(
  files: Record<string, Uint8Array>,
  path = 'xl/theme/theme1.xml'
): (string | undefined)[] {
  const order = [
    'lt1',
    'dk1',
    'lt2',
    'dk2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ];
  const colors: Record<string, string> = {};
  if (!files[path]) return order.map(() => undefined);
  const parser = new SaxesParser({ xmlns: true });
  let current: string | undefined;
  let inScheme = false;
  parser.on('opentag', (node) => {
    if (node.local === 'clrScheme') inScheme = true;
    else if (inScheme && order.includes(node.local)) current = node.local;
    else if (inScheme && current && !colors[current]) {
      const value = attributes(node);
      const hex =
        node.local === 'sysClr'
          ? value.lastClr
          : node.local === 'srgbClr'
            ? value.val
            : undefined;
      if (hex && /^[0-9a-f]{6}$/i.test(hex))
        colors[current] = hex.toUpperCase();
    }
  });
  parser.on('closetag', (node) => {
    if (node.local === 'clrScheme') inScheme = false;
    if (node.local === current) current = undefined;
  });
  parser.write(strFromU8(files[path])).close();
  return order.map((key) => colors[key]);
}

/** Excel's tint: scale HSL luminance toward black (negative) or white. */
function tinted(hex: string, tint: number): string {
  if (!tint) return hex;
  return withLightness(hex, (lightness) =>
    tint < 0 ? lightness * (1 + tint) : lightness * (1 - tint) + tint
  );
}

/** A color (RRGGBB) with its HSL lightness changed. */
export function withLightness(
  hex: string,
  change: (lightness: number) => number
): string {
  const [r, g, b] = [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  hue = (hue * 60 + 360) % 360;
  lightness = Math.min(1, Math.max(0, change(lightness)));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [red, green, blue] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return [red, green, blue]
    .map((value) =>
      Math.round(Math.min(1, Math.max(0, value + m)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();
}

export type XlsxStylesheet = {
  /** Macro styles for a cell's `s` index, relative to `defaultFont`. */
  cellStyle: (index: number) => SpreadsheetCellStyle;
  /** The format of a conditional formatting rule's `dxfId`. */
  differentialStyle: (index: number) => ConditionalStyle | undefined;
  /**
   * Reads a format written inside an Excel 2010 rule, one element at a time
   * with its parent's name, then converts it.
   */
  inlineDifferential: () => {
    read: (local: string, parent: string, value: Attributes) => void;
    style: () => ConditionalStyle;
  };
  /** A `<color>` element's attributes as #RRGGBB. */
  color: (attributes: Record<string, string>) => string | undefined;
  /** The Excel number format code for a cell's `s` index. */
  numberFormat: (index: number) => string;
  /** A custom number format's code by its `numFmtId`. */
  customFormat: (id: number) => string | undefined;
  /** The workbook's Normal font; cells only store differences from it. */
  defaultFont?: { name: string; size: number };
};

/** Parse styles.xml once into lookups shared by every worksheet. */
export function readXlsxStylesheet(
  text: string,
  theme: (string | undefined)[],
  warnings: Set<string>
): XlsxStylesheet {
  const formats = new Map<number, string>();
  const fonts: Font[] = [];
  const fills: Fill[] = [];
  const borders: Record<string, Edge>[] = [];
  const xfs: Xf[] = [];
  const dxfs: Dxf[] = [];
  let dxf: Dxf | undefined;
  const palette = [...INDEXED_COLORS];
  const customPalette: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  let font: Font | undefined;
  let fill: Fill | undefined;
  let border: Record<string, Edge> | undefined;
  let edge: string | undefined;
  let xf: Xf | undefined;
  parser.on('doctype', () => {
    throw new Error('Unsupported XML document type in xl/styles.xml.');
  });
  parser.on('opentag', (node) => {
    const parent = stack.at(-1);
    stack.push(node.local);
    const value = attributes(node);
    if (node.local === 'dxf' && parent === 'dxfs') {
      dxf = {};
      return;
    }
    if (dxf) {
      readDifferential(dxf, node.local, parent, value);
      return;
    }
    switch (node.local) {
      case 'numFmt':
        if (parent === 'numFmts' && value.formatCode !== undefined)
          formats.set(Number(value.numFmtId), value.formatCode);
        return;
      case 'rgbColor':
        if (
          parent === 'indexedColors' &&
          /^[0-9a-f]{8}$/i.test(value.rgb ?? '')
        )
          customPalette.push(value.rgb.slice(2).toUpperCase());
        return;
      case 'font':
        if (parent === 'fonts') font = {};
        return;
      case 'fill':
        if (parent === 'fills') fill = {};
        return;
      case 'border':
        if (parent === 'borders') border = {};
        return;
      case 'xf':
        if (parent === 'cellXfs')
          xf = {
            numFmtId: Number(value.numFmtId ?? 0),
            fontId: Number(value.fontId ?? 0),
            fillId: Number(value.fillId ?? 0),
            borderId: Number(value.borderId ?? 0),
          };
        return;
      case 'alignment':
        if (xf && parent === 'xf') xf.alignment = value;
        return;
    }
    if (font && parent === 'font') {
      if (node.local === 'b') font.bold = flag(value);
      else if (node.local === 'i') font.italic = flag(value);
      else if (node.local === 'strike') font.strike = flag(value);
      else if (node.local === 'u') font.underline = value.val ?? 'single';
      else if (node.local === 'sz') font.size = Number(value.val);
      else if (node.local === 'name' || node.local === 'rFont')
        font.name = value.val;
      else if (node.local === 'color') font.color = value;
      else if (
        (node.local === 'vertAlign' && value.val !== 'baseline') ||
        (['outline', 'shadow'].includes(node.local) && flag(value))
      )
        font.effects = true;
    } else if (fill && parent === 'patternFill') {
      if (node.local === 'fgColor') fill.fg = value;
      else if (node.local === 'bgColor') fill.bg = value;
    } else if (fill && node.local === 'patternFill') {
      fill.pattern = value.patternType ?? 'none';
    } else if (fill && node.local === 'gradientFill') {
      fill.gradient = [];
    } else if (fill?.gradient && node.local === 'color' && parent === 'stop') {
      fill.gradient.push(value);
    } else if (border && parent === 'border') {
      edge = { start: 'left', end: 'right' }[node.local] ?? node.local;
      border[edge] = { style: value.style };
    } else if (border && edge && node.local === 'color') {
      border[edge].color = value;
    }
  });
  parser.on('closetag', (node) => {
    stack.pop();
    if (node.local === 'dxf' && dxf) {
      dxfs.push(dxf);
      dxf = undefined;
    } else if (node.local === 'font' && font) {
      fonts.push(font);
      font = undefined;
    } else if (node.local === 'fill' && fill) {
      fills.push(fill);
      fill = undefined;
    } else if (node.local === 'border' && border) {
      borders.push(border);
      border = undefined;
    } else if (node.local === 'xf' && xf && stack.at(-1) === 'cellXfs') {
      xfs.push(xf);
      xf = undefined;
    } else if (border && node.local === edge) edge = undefined;
  });
  if (text.trim()) parser.write(text).close();
  if (customPalette.length)
    palette.splice(0, customPalette.length, ...customPalette);

  const color = (spec: ColorSpec): string | undefined => {
    if (!spec || spec.auto === '1' || spec.auto === 'true') return;
    let hex: string | undefined;
    if (spec.rgb && /^[0-9a-f]{6,8}$/i.test(spec.rgb)) hex = spec.rgb.slice(-6);
    else if (spec.theme !== undefined) hex = theme[Number(spec.theme)];
    else if (spec.indexed !== undefined) {
      const index = Number(spec.indexed);
      // 64 and 65 are the system foreground and background (automatic).
      if (index >= 64) return;
      hex = palette[index];
    }
    if (!hex) {
      warnings.add('Some custom theme colors could not be imported.');
      return;
    }
    return `#${tinted(hex.toUpperCase(), Number(spec.tint ?? 0))}`;
  };
  const blend = (front: string, back: string, amount: number) =>
    `#${[1, 3, 5]
      .map((offset) =>
        Math.round(
          Number.parseInt(front.slice(offset, offset + 2), 16) * amount +
            Number.parseInt(back.slice(offset, offset + 2), 16) * (1 - amount)
        )
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
      .toUpperCase()}`;
  const patternDensity: Record<string, number> = {
    gray125: 0.125,
    gray0625: 0.0625,
    lightGray: 0.25,
    mediumGray: 0.5,
    darkGray: 0.75,
  };

  const styles = new Map<number, SpreadsheetCellStyle>();
  const formatCode = (index: number) => {
    const id = xfs[index]?.numFmtId ?? 0;
    return formats.get(id) ?? BUILTIN_FORMATS[id] ?? 'General';
  };
  const build = (index: number): SpreadsheetCellStyle => {
    const definition = xfs[index];
    if (!definition) return {};
    let result: SpreadsheetCellStyle;
    try {
      result = readNumberFormat(formatCode(index));
    } catch {
      warnings.add(
        'Some unsupported Excel number formats were reset to General.'
      );
      result = {};
    }
    const cellFont = fonts[definition.fontId];
    const base = fonts[0];
    const baseColor = color(base?.color);
    if (cellFont) {
      if (cellFont.bold) result.bold = true;
      if (cellFont.italic) result.italic = true;
      if (cellFont.underline && cellFont.underline !== 'none')
        result.underline = true;
      if (cellFont.strike) result.strikethrough = true;
      if (
        cellFont.size &&
        Number.isFinite(cellFont.size) &&
        cellFont.size !== base?.size
      ) {
        result.fontSize = Math.min(36, Math.max(8, Math.round(cellFont.size)));
        if (result.fontSize !== cellFont.size)
          warnings.add('Font sizes are rounded and limited to 8–36 pt.');
      }
      if (cellFont.name && cellFont.name !== base?.name) {
        result.fontFamily = /courier|mono|consolas/i.test(cellFont.name)
          ? 'mono'
          : /times|georgia|serif|garamond|cambria|book antiqua/i.test(
                cellFont.name
              ) && !/sans/i.test(cellFont.name)
            ? 'serif'
            : 'sans';
        if (
          cellFont.name !==
          { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' }[
            result.fontFamily
          ]
        )
          result.fontName = cellFont.name.slice(0, 128);
      }
      // A font that names its own color keeps it, even when it resolves to
      // the default font's color; fonts that inherit it store nothing.
      const text = color(cellFont.color);
      if (
        text &&
        (text !== baseColor ||
          JSON.stringify(cellFont.color) !== JSON.stringify(base?.color))
      )
        result.textColor = text;
      if (
        cellFont.effects ||
        (cellFont.underline &&
          !['single', 'none', 'singleAccounting'].includes(cellFont.underline))
      )
        warnings.add(
          'Special font effects are simplified to the supported text formatting.'
        );
    }
    const cellFill = fills[definition.fillId];
    if (cellFill?.gradient?.length) {
      const first = color(cellFill.gradient[0]);
      if (first) result.fillColor = first;
      warnings.add('Gradient fills are shown with their first color.');
    } else if (cellFill?.pattern && cellFill.pattern !== 'none') {
      // Solid fills use the foreground colour; a missing one means black.
      const front = color(cellFill.fg) ?? '#000000';
      if (cellFill.pattern === 'solid') result.fillColor = front;
      else {
        const back = color(cellFill.bg) ?? '#FFFFFF';
        result.fillColor = blend(
          front,
          back,
          patternDensity[cellFill.pattern] ?? 0.5
        );
        warnings.add('Patterned fills are shown as a blended solid color.');
      }
    }
    const alignment = definition.alignment;
    if (alignment) {
      const horizontal = alignment.horizontal;
      if (
        horizontal === 'left' ||
        horizontal === 'center' ||
        horizontal === 'right'
      )
        result.horizontalAlign = horizontal;
      // Center Across Selection is the usual financial-model title layout.
      else if (
        horizontal === 'centerContinuous' ||
        horizontal === 'distributed'
      )
        result.horizontalAlign = 'center';
      else if (horizontal === 'justify' || horizontal === 'fill')
        result.horizontalAlign = 'left';
      const vertical = alignment.vertical;
      if (vertical === 'top' || vertical === 'bottom')
        result.verticalAlign = vertical;
      else if (vertical === 'center') result.verticalAlign = 'middle';
      else if (vertical === 'justify' || vertical === 'distributed')
        result.verticalAlign = 'top';
      if (flag({ val: alignment.wrapText ?? '0' })) result.wrap = true;
      if (
        Number(alignment.textRotation ?? 0) ||
        flag({ val: alignment.shrinkToFit ?? '0' }) ||
        alignment.readingOrder === '2'
      )
        warnings.add(
          'Text rotation, shrink-to-fit and right-to-left layout are not imported.'
        );
    }
    const cellBorder = borders[definition.borderId];
    for (const [edgeName, key] of [
      ['top', 'borderTop'],
      ['right', 'borderRight'],
      ['bottom', 'borderBottom'],
      ['left', 'borderLeft'],
    ] as const) {
      const line = cellBorder?.[edgeName];
      if (!line?.style || line.style === 'none') continue;
      result[key] = true;
      if (line.style !== 'thin') result[`${key}Style`] = line.style;
      const lineColor = color(line.color);
      if (lineColor && lineColor !== '#808080')
        result[`${key}Color`] = lineColor;
    }
    if (cellBorder?.diagonal?.style && cellBorder.diagonal.style !== 'none')
      warnings.add('Diagonal borders are not imported.');
    return Object.fromEntries(
      Object.entries(result).filter(
        ([key, value]) =>
          value !== undefined &&
          value !== SPREADSHEET_DEFAULT_STYLE[key as keyof SpreadsheetCellStyle]
      )
    );
  };
  const conditionalStyle = (definition: Dxf): ConditionalStyle => {
    const style: ConditionalStyle = {};
    const { font: dxfFont, fill: dxfFill } = definition;
    if (dxfFont?.bold !== undefined) style.bold = dxfFont.bold;
    if (dxfFont?.italic !== undefined) style.italic = dxfFont.italic;
    if (dxfFont?.underline !== undefined)
      style.underline = dxfFont.underline !== 'none';
    if (dxfFont?.strike !== undefined) style.strikethrough = dxfFont.strike;
    const text = color(dxfFont?.color);
    if (text) style.textColor = text;
    // A rule's solid fill is its background color; some writers use the
    // foreground color instead.
    if (dxfFill && dxfFill.pattern !== 'none') {
      const background = color(dxfFill.bg) ?? color(dxfFill.fg);
      if (background) style.fillColor = background;
    }
    if (definition.numberFormat) style.numberFormat = definition.numberFormat;
    return style;
  };
  return {
    differentialStyle: (index) =>
      dxfs[index] ? conditionalStyle(dxfs[index]) : undefined,
    inlineDifferential() {
      const dxf: Dxf = {};
      return {
        read: (local, parent, value) =>
          readDifferential(dxf, local, parent, value),
        style: () => conditionalStyle(dxf),
      };
    },
    color: (spec) => color(spec),
    cellStyle(index) {
      let style = styles.get(index);
      if (!style) {
        style = build(index);
        styles.set(index, style);
      }
      return style;
    },
    numberFormat: formatCode,
    customFormat: (id) => formats.get(id),
    defaultFont:
      fonts[0]?.name && fonts[0].size && Number.isFinite(fonts[0].size)
        ? {
            name: fonts[0].name.slice(0, 128),
            size: Math.min(36, Math.max(8, Math.round(fonts[0].size))),
          }
        : undefined,
  };
}
