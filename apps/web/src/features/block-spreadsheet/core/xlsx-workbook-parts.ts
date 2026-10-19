import type { SpreadsheetCell } from './spreadsheet-document';
import { CHECKBOX_XF_EXTENSION } from './xlsx-checkboxes';
import { differentialXml } from './xlsx-sheet-rules';
import { type XlsxCellStyle, xlsxCellStyle } from './xlsx-styles';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const BUILTIN_FORMATS: Record<string, number> = {
  General: 0,
  '0': 1,
  '0.00': 2,
  '#,##0': 3,
  '#,##0.00': 4,
  '0%': 9,
  '0.00%': 10,
  '0.00E+00': 11,
  '@': 49,
};

/** Escape text for XML, including characters XML 1.0 cannot carry. */
export function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\r', '&#13;');
}

/** Cell text uses OOXML's `_xHHHH_` escape for control characters. */
export function escapeText(value: string) {
  return escapeXml(
    value.replace(/_(x[0-9a-f]{4}_)/gi, '_x005F_$1').replace(
      // Everything XML 1.0 cannot carry: control characters other than tab,
      // line feed and carriage return, and U+FFFE/U+FFFF.
      /[^\t\n\r -\ud7ff\ud800-\udfff\ue000-\ufffd]/g,
      (character) =>
        `_x${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`
    )
  );
}

function text(value: string) {
  return /^\s|\s$/.test(value)
    ? `<t xml:space="preserve">${escapeText(value)}</t>`
    : `<t>${escapeText(value)}</t>`;
}

export function numberText(value: number) {
  return Number.isFinite(value) ? String(value) : '0';
}

/** Deduplicate fonts, fills, borders, formats and cell formats. */
export class StyleTable {
  private formats = new Map<string, number>();
  private fonts = new Map<string, number>();
  private fills = new Map<string, number>([
    ['<patternFill patternType="none"/>', 0],
    ['<patternFill patternType="gray125"/>', 1],
  ]);
  private borders = new Map<string, number>([['', 0]]);
  private xfs = new Map<string, number>();
  private cache = new Map<string, number>();
  private dxfs = new Map<string, number>();

  /** The `dxfId` of a conditional format's differential format. */
  dxf(style: Parameters<typeof differentialXml>[0]): number {
    const key = differentialXml(
      style,
      style?.numberFormat ? this.format(style.numberFormat) : undefined
    );
    let index = this.dxfs.get(key);
    if (index === undefined) {
      index = this.dxfs.size;
      this.dxfs.set(key, index);
    }
    return index;
  }

  constructor(defaultFont: { name: string; size: number }) {
    this.font({
      ...defaultFont,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    });
    this.xfs.set('0,0,0,0,0,', 0);
  }

  /** Whether any cell format is Excel's checkbox. */
  hasCheckboxes(): boolean {
    return [...this.xfs.keys()].some((key) => key.split(',')[4] === '1');
  }

  /** The `numFmtId` of a number format code. */
  format(code: string): number {
    let format: number | undefined = BUILTIN_FORMATS[code];
    if (format === undefined) {
      format = this.formats.get(code);
      if (format === undefined) {
        format = 164 + this.formats.size;
        this.formats.set(code, format);
      }
    }
    return format;
  }

  private font(font: XlsxCellStyle['font']) {
    const key = [
      font.bold && '<b/>',
      font.italic && '<i/>',
      font.strike && '<strike/>',
      font.underline && '<u/>',
      `<sz val="${numberText(font.size)}"/>`,
      font.color && `<color rgb="FF${font.color}"/>`,
      `<name val="${escapeXml(font.name)}"/>`,
    ]
      .filter(Boolean)
      .join('');
    let index = this.fonts.get(key);
    if (index === undefined) {
      index = this.fonts.size;
      this.fonts.set(key, index);
    }
    return index;
  }

  /** The `s` index for a cell, or 0 for the workbook default. */
  index(
    cell: SpreadsheetCell,
    defaultFont?: { name: string; size: number }
  ): number {
    const key = JSON.stringify([{ ...cell, value: '' }, defaultFont]);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const style = xlsxCellStyle(cell, defaultFont);
    const format = this.format(style.numFmt);
    const font = this.font(style.font);
    let fill = 0;
    if (style.fill) {
      const key = `<patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill>`;
      fill = this.fills.get(key) ?? this.fills.size;
      this.fills.set(key, fill);
    }
    const borderKey = (['left', 'right', 'top', 'bottom'] as const)
      .map((edge) => {
        const line = style.border[edge];
        return line
          ? `<${edge} style="${line.style}"><color rgb="FF${line.color}"/></${edge}>`
          : `<${edge}/>`;
      })
      .join('');
    const border = Object.keys(style.border).length
      ? (this.borders.get(borderKey) ?? this.borders.size)
      : 0;
    if (border) this.borders.set(borderKey, border);
    const alignment = [
      style.alignment.horizontal &&
        `horizontal="${style.alignment.horizontal}"`,
      style.alignment.indent && `indent="${style.alignment.indent}"`,
      style.alignment.vertical !== 'bottom' &&
        `vertical="${style.alignment.vertical}"`,
      style.alignment.wrapText && 'wrapText="1"',
    ]
      .filter(Boolean)
      .join(' ');
    const xfKey = `${format ?? 0},${font},${fill},${border},${style.checkbox ? 1 : 0},${alignment}`;
    let index = this.xfs.get(xfKey);
    if (index === undefined) {
      index = this.xfs.size;
      this.xfs.set(xfKey, index);
    }
    this.cache.set(key, index);
    return index;
  }

  xml(): string {
    const formats = [...this.formats]
      .map(
        ([code, id]) =>
          `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`
      )
      .join('');
    const xfs = [...this.xfs.keys()]
      .map((key) => {
        const [format, font, fill, border, checkbox, ...rest] = key.split(',');
        const alignment = rest.join(',');
        const children = `${alignment ? `<alignment ${alignment}/>` : ''}${checkbox === '1' ? CHECKBOX_XF_EXTENSION : ''}`;
        return `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${format !== '0' ? ' applyNumberFormat="1"' : ''}${font !== '0' ? ' applyFont="1"' : ''}${fill !== '0' ? ' applyFill="1"' : ''}${border !== '0' ? ' applyBorder="1"' : ''}${alignment ? ' applyAlignment="1"' : ''}${children ? `>${children}</xf>` : '/>'}`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN}">${
      this.formats.size
        ? `<numFmts count="${this.formats.size}">${formats}</numFmts>`
        : ''
    }<fonts count="${this.fonts.size}">${[...this.fonts.keys()]
      .map((font) => `<font>${font}</font>`)
      .join('')}</fonts><fills count="${this.fills.size}">${[
      ...this.fills.keys(),
    ]
      .map((fill) => `<fill>${fill}</fill>`)
      .join('')}</fills><borders count="${this.borders.size}">${[
      ...this.borders.keys(),
    ]
      .map(
        (border) =>
          `<border>${border || '<left/><right/><top/><bottom/>'}<diagonal/></border>`
      )
      .join(
        ''
      )}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.size}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${this.dxfs.size}">${[...this.dxfs.keys()].join('')}</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

export class SharedStrings {
  private strings = new Map<string, number>();
  private count = 0;

  index(value: string) {
    this.count++;
    let index = this.strings.get(value);
    if (index === undefined) {
      index = this.strings.size;
      this.strings.set(value, index);
    }
    return index;
  }

  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${MAIN}" count="${this.count}" uniqueCount="${this.strings.size}">${[
      ...this.strings.keys(),
    ]
      .map((value) => `<si>${text(value)}</si>`)
      .join('')}</sst>`;
  }
}
