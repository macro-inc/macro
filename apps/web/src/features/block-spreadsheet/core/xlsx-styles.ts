import {
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCell,
  type SpreadsheetCellStyle,
} from './spreadsheet-document';

type Edge = 'left' | 'right' | 'top' | 'bottom';

/** The SpreadsheetML pieces of one Macro cell style. Colors are RRGGBB. */
export type XlsxCellStyle = {
  numFmt: string;
  font: {
    name: string;
    size: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    color?: string;
  };
  alignment: {
    horizontal?: 'left' | 'center' | 'right';
    vertical: 'top' | 'center' | 'bottom';
    wrapText: boolean;
  };
  fill?: string;
  border: Partial<Record<Edge, { style: string; color: string }>>;
};

const FONT_NAMES = { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' };

/** The Excel format code for Macro's built-in formats and precision. */
function numberFormatCode(style: Required<SpreadsheetCellStyle>) {
  const digits = Math.max(0, style.decimals < 0 ? 2 : style.decimals);
  const fraction = digits ? `.${'0'.repeat(digits)}` : '';
  return {
    general: style.decimals < 0 ? 'General' : `0${fraction}`,
    number: `#,##0${fraction}`,
    currency: `$#,##0${fraction}`,
    percent: `0${style.decimals < 0 ? '.##' : fraction}%`,
    date: 'm/d/yyyy',
    time: 'h:mm:ss AM/PM',
    scientific: `0${fraction}E+00`,
    text: '@',
  }[style.format];
}

/** The Excel number format code a cell displays with. */
export function cellNumberFormat(cell: SpreadsheetCellStyle): string {
  return (
    cell.numberFormat ||
    numberFormatCode({ ...SPREADSHEET_DEFAULT_STYLE, ...cell })
  );
}

/** Map an Excel number format to Macro's format vocabulary, retaining the
 * original code whenever Macro's built-in format would display differently. */
export function readNumberFormat(format: string): SpreadsheetCellStyle {
  if (!format || format.toLowerCase() === 'general') return {};
  if (format === '@') return { format: 'text' };
  // Keep elapsed-time markers such as [h]; drop colors, locales and conditions.
  const tokens = format
    .replace(/"[^"]*"|\\.|\[(?![hms]+\])[^\]]*\]/gi, '')
    .split(';')[0];
  const decimals = Math.min(10, /\.([0#]+)/.exec(tokens)?.[1].length ?? 0);
  let style: SpreadsheetCellStyle;
  if (/[dy]/i.test(tokens)) style = { format: 'date' };
  else if (/[hs]/i.test(tokens)) style = { format: 'time' };
  else if (tokens.includes('%'))
    style = { format: 'percent', decimals: tokens === '0.##%' ? -1 : decimals };
  else if (/E[+-]?0/i.test(tokens)) style = { format: 'scientific', decimals };
  else if (/\$/.test(format)) style = { format: 'currency', decimals };
  else if (/[0#]/.test(tokens))
    style = { format: tokens.includes(',') ? 'number' : 'general', decimals };
  else style = {};
  // Retain the actual format instead of approximating accounting sections,
  // negative parentheses, scaling, currencies, or date/time precision.
  if (
    format.length > 512 ||
    Array.from(format).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('A cell has an unsupported Excel number format.');
  if (numberFormatCode({ ...SPREADSHEET_DEFAULT_STYLE, ...style }) !== format)
    style.numberFormat = format;
  return style;
}

/** Excel style parts for a cell. Font properties the cell does not set come
 * from the sheet's imported default font, else Macro's default. */
export function xlsxCellStyle(
  cell: SpreadsheetCell,
  defaultFont?: { name: string; size: number }
): XlsxCellStyle {
  const style = { ...SPREADSHEET_DEFAULT_STYLE, ...cell };
  const border: XlsxCellStyle['border'] = {};
  for (const [edge, key] of [
    ['top', 'borderTop'],
    ['right', 'borderRight'],
    ['bottom', 'borderBottom'],
    ['left', 'borderLeft'],
  ] as const) {
    if (!style[key]) continue;
    border[edge] = {
      style: style[`${key}Style`] || 'thin',
      color: style[`${key}Color`]?.slice(1).toUpperCase() || '808080',
    };
  }
  return {
    numFmt: style.numberFormat || numberFormatCode(style),
    font: {
      name:
        style.fontName ||
        (cell.fontFamily || !defaultFont
          ? FONT_NAMES[style.fontFamily]
          : defaultFont.name),
      size: cell.fontSize ?? defaultFont?.size ?? style.fontSize,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strikethrough,
      ...(style.textColor && {
        color: style.textColor.slice(1).toUpperCase(),
      }),
    },
    alignment: {
      ...(style.horizontalAlign !== 'auto' && {
        horizontal: style.horizontalAlign,
      }),
      vertical:
        style.verticalAlign === 'middle' ? 'center' : style.verticalAlign,
      wrapText: style.wrap,
    },
    ...(style.fillColor && { fill: style.fillColor.slice(1).toUpperCase() }),
    border,
  };
}
