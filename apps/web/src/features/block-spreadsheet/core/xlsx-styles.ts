import type { Cell, Color, Style } from 'exceljs';
import { strFromU8 } from 'fflate';
import {
  SPREADSHEET_DEFAULT_STYLE,
  type SpreadsheetCell,
  type SpreadsheetCellStyle,
} from './spreadsheet-document';

export function readXlsxTheme(files: Record<string, Uint8Array>) {
  const text = files['xl/theme/theme1.xml']
    ? strFromU8(files['xl/theme/theme1.xml'])
    : '';
  return [
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
  ].map((key) => {
    const part =
      new RegExp(`<(?:\\w+:)?${key}>([\\s\\S]*?)<\\/(?:\\w+:)?${key}>`).exec(
        text
      )?.[1] ?? '';
    return /(?:lastClr|val)="([0-9a-f]{6})"/i.exec(part)?.[1];
  });
}
function colorValue(
  color: Partial<Color> | undefined,
  theme: (string | undefined)[],
  warnings: Set<string>
) {
  if (!color) return undefined;
  if ('tint' in color && color.tint)
    warnings.add('Tinted theme colors are approximated with their base color.');
  const hex =
    color.argb?.slice(-6) ??
    (color.theme === undefined ? undefined : theme[color.theme]);
  if (hex && /^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  warnings.add('Some indexed or custom theme colors could not be imported.');
  return undefined;
}
function readNumberFormat(
  format: string,
  warnings: Set<string>
): SpreadsheetCellStyle {
  if (!format || format.toLowerCase() === 'general') return {};
  if (format === '@') return { format: 'text' };
  const tokens = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '').split(';')[0];
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
  const standard =
    /^(?:General|@|#,##0(?:\.[0#]{1,10})?|0(?:\.[0#]{1,10})?%?|\$#,##0(?:\.[0#]{1,10})?|0(?:\.[0#]{1,10})?E\+00|m\/d\/(?:yy|yyyy)|mm\/dd\/yyyy|h:mm(?::ss)?(?: AM\/PM)?)$/i.test(
      format
    );
  if (!standard)
    warnings.add(
      'Custom number formats are approximated by the available number, date, time or currency formats.'
    );
  return style;
}
export function readXlsxStyle(
  cell: Cell,
  theme: (string | undefined)[],
  warnings: Set<string>
): SpreadsheetCellStyle {
  const result = readNumberFormat(cell.numFmt, warnings);
  const font = cell.font;
  if (font) {
    if (font.bold) result.bold = true;
    if (font.italic) result.italic = true;
    if (font.underline && font.underline !== 'none') result.underline = true;
    if (font.strike) result.strikethrough = true;
    if (font.size) {
      result.fontSize = Math.min(36, Math.max(8, Math.round(font.size)));
      if (result.fontSize !== font.size)
        warnings.add('Font sizes are rounded and limited to 8–36 pt.');
    }
    if (font.name) {
      result.fontFamily = /courier|mono|consolas/i.test(font.name)
        ? 'mono'
        : /times|georgia|serif/i.test(font.name)
          ? 'serif'
          : 'sans';
      if (
        !['Arial', 'Calibri', 'Inter', 'Georgia', 'Courier New'].includes(
          font.name
        )
      )
        warnings.add(
          'Fonts are mapped to the available sans, serif and monospace families.'
        );
    }
    const color = colorValue(font.color, theme, warnings);
    if (color) result.textColor = color;
    if (
      font.vertAlign ||
      font.outline ||
      (typeof font.underline === 'string' &&
        font.underline !== 'single' &&
        font.underline !== 'none')
    )
      warnings.add(
        'Special font effects are simplified to the supported text formatting.'
      );
  }
  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const color = colorValue(fill.fgColor, theme, warnings);
    if (color) result.fillColor = color;
  } else if (
    fill &&
    !(fill.type === 'pattern' && (!fill.pattern || fill.pattern === 'none'))
  )
    warnings.add('Gradient and patterned fills are not imported.');
  const alignment = cell.alignment;
  if (alignment) {
    if (
      alignment.horizontal === 'left' ||
      alignment.horizontal === 'center' ||
      alignment.horizontal === 'right'
    )
      result.horizontalAlign = alignment.horizontal;
    else if (alignment.horizontal)
      warnings.add(
        'Special horizontal alignment is reset to automatic alignment.'
      );
    if (
      alignment.vertical === 'top' ||
      alignment.vertical === 'middle' ||
      alignment.vertical === 'bottom'
    )
      result.verticalAlign = alignment.vertical;
    else if (alignment.vertical)
      warnings.add('Special vertical alignment is reset to middle alignment.');
    if (alignment.wrapText) result.wrap = true;
    if (
      alignment.indent ||
      alignment.textRotation ||
      alignment.shrinkToFit ||
      alignment.readingOrder === 'rtl'
    )
      warnings.add(
        'Text rotation, indentation, shrink-to-fit and right-to-left layout are not imported.'
      );
  }
  for (const [edge, key] of [
    ['top', 'borderTop'],
    ['right', 'borderRight'],
    ['bottom', 'borderBottom'],
    ['left', 'borderLeft'],
  ] as const) {
    const border = cell.border?.[edge];
    if (border?.style) {
      result[key] = true;
      if (
        border.style !== 'thin' ||
        (border.color?.argb &&
          !/^(?:FF)?(?:000000|808080)$/i.test(border.color.argb))
      )
        warnings.add(
          'Border colors and line styles are simplified to standard cell borders.'
        );
    }
  }
  if (cell.border?.diagonal?.style)
    warnings.add('Diagonal borders are not imported.');
  return Object.fromEntries(
    Object.entries(result).filter(
      ([key, value]) =>
        value !== SPREADSHEET_DEFAULT_STYLE[key as keyof SpreadsheetCellStyle]
    )
  );
}
export function writeXlsxStyle(cell: SpreadsheetCell): Partial<Style> {
  const style = { ...SPREADSHEET_DEFAULT_STYLE, ...cell };
  const digits = Math.max(0, style.decimals < 0 ? 2 : style.decimals);
  const fraction = digits ? `.${'0'.repeat(digits)}` : '';
  const numberFormat = {
    general: style.decimals < 0 ? 'General' : `0${fraction}`,
    number: `#,##0${fraction}`,
    currency: `$#,##0${fraction}`,
    percent: `0${style.decimals < 0 ? '.##' : fraction}%`,
    date: 'm/d/yyyy',
    time: 'h:mm:ss AM/PM',
    scientific: `0${fraction}E+00`,
    text: '@',
  }[style.format];
  const rgb = (value: string) => ({
    argb: `FF${value.slice(1).toUpperCase()}`,
  });
  return {
    numFmt: numberFormat,
    font: {
      name: { sans: 'Arial', serif: 'Georgia', mono: 'Courier New' }[
        style.fontFamily
      ],
      size: style.fontSize,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      strike: style.strikethrough,
      ...(style.textColor && { color: rgb(style.textColor) }),
    },
    alignment: {
      ...(style.horizontalAlign !== 'auto' && {
        horizontal: style.horizontalAlign,
      }),
      vertical: style.verticalAlign,
      wrapText: style.wrap,
    },
    ...(style.fillColor && {
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: rgb(style.fillColor),
      },
    }),
    border: Object.fromEntries(
      (
        [
          ['top', style.borderTop],
          ['right', style.borderRight],
          ['bottom', style.borderBottom],
          ['left', style.borderLeft],
        ] as const
      )
        .filter(([, enabled]) => enabled)
        .map(([edge]) => [edge, { style: 'thin', color: { argb: 'FF808080' } }])
    ),
  };
}
