import {
  parseCellAddress,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';

/** Excel layout and definitions retained independently from editable cell maps. */
export type WorkbookSheetMetadata = {
  merges?: string[];
  rowHeights?: Record<number, number>;
  hiddenRows?: number[];
  hiddenColumns?: number[];
  hidden?: boolean;
  freeze?: { rows: number; columns: number };
  autoFilter?: string;
  definedNames?: { name: string; formula: string; local?: boolean }[];
};

export function validWorkbookRange(range: unknown): range is string {
  if (typeof range !== 'string') return false;
  const parts = range.split(':');
  const first = parseCellAddress(parts[0]);
  const last = parseCellAddress(parts[1] ?? parts[0]);
  return (
    parts.length <= 2 &&
    !!first &&
    !!last &&
    first.row <= last.row &&
    first.column <= last.column
  );
}

export function parseWorkbookMetadata(
  encoded: unknown
): WorkbookSheetMetadata | undefined {
  if (typeof encoded !== 'string' || encoded.length > 100_000) return;
  try {
    const value = JSON.parse(encoded);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (
      Object.keys(value).some(
        (key) =>
          ![
            'merges',
            'rowHeights',
            'hiddenRows',
            'hiddenColumns',
            'hidden',
            'freeze',
            'autoFilter',
            'definedNames',
          ].includes(key)
      )
    )
      return;
    const indices = (values: unknown, limit: number) =>
      values === undefined ||
      (Array.isArray(values) &&
        values.length <= limit &&
        values.every((v) => Number.isInteger(v) && v >= 0 && v < limit));
    if (
      value.merges !== undefined &&
      (!Array.isArray(value.merges) ||
        value.merges.length > 1000 ||
        !value.merges.every(validWorkbookRange))
    )
      return;
    if (
      !indices(value.hiddenRows, SPREADSHEET_MAX_ROWS) ||
      !indices(value.hiddenColumns, SPREADSHEET_COLUMNS)
    )
      return;
    if (
      value.rowHeights !== undefined &&
      (!value.rowHeights ||
        typeof value.rowHeights !== 'object' ||
        Array.isArray(value.rowHeights) ||
        !Object.entries(value.rowHeights).every(
          ([key, height]) =>
            /^\d+$/.test(key) &&
            +key < SPREADSHEET_MAX_ROWS &&
            typeof height === 'number' &&
            Number.isFinite(height) &&
            height >= 0 &&
            height <= 409.5
        ))
    )
      return;
    if (value.hidden !== undefined && typeof value.hidden !== 'boolean') return;
    if (
      value.freeze !== undefined &&
      (!value.freeze ||
        Object.keys(value.freeze).length !== 2 ||
        !Number.isInteger(value.freeze.rows) ||
        value.freeze.rows < 0 ||
        value.freeze.rows > SPREADSHEET_MAX_ROWS ||
        !Number.isInteger(value.freeze.columns) ||
        value.freeze.columns < 0 ||
        value.freeze.columns > SPREADSHEET_COLUMNS)
    )
      return;
    if (value.autoFilter !== undefined && !validWorkbookRange(value.autoFilter))
      return;
    if (
      value.definedNames !== undefined &&
      (!Array.isArray(value.definedNames) ||
        value.definedNames.length > 256 ||
        !value.definedNames.every((entry: unknown) => {
          if (
            !entry ||
            typeof entry !== 'object' ||
            Object.keys(entry).some(
              (key) => !['name', 'formula', 'local'].includes(key)
            )
          )
            return false;
          const { name, formula, local } = entry as Record<string, unknown>;
          return (
            typeof name === 'string' &&
            name.length > 0 &&
            name.length <= 255 &&
            typeof formula === 'string' &&
            formula.length <= 10_000 &&
            (local === undefined || typeof local === 'boolean')
          );
        }))
    )
      return;
    return value;
  } catch {
    return;
  }
}
