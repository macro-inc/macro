import Papa from 'papaparse';

export type DatabaseCsv = {
  columns: string[];
  rows: string[][];
};

export const MAX_CSV_BYTES = 8 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;
export const MAX_CSV_COLUMNS = 100;

/** Keep every CSV value as text: importing must not round numbers or lose zeroes. */
export function parseDatabaseCsv(text: string): DatabaseCsv {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES)
    throw new Error('Choose a CSV smaller than 8 MB.');
  const result = Papa.parse<string[]>(text, {
    delimiter: ',',
    dynamicTyping: false,
    skipEmptyLines: true,
  });
  if (result.errors.length) {
    const error = result.errors[0];
    throw new Error(`CSV row ${(error.row ?? 0) + 1}: ${error.message}`);
  }
  const rows = result.data;
  const header = rows.shift();
  if (!header?.some((value) => value.trim()))
    throw new Error('The CSV needs a header row.');
  if (header.length > MAX_CSV_COLUMNS)
    throw new Error('A CSV can contain up to 100 columns.');
  if (rows.length > MAX_CSV_ROWS)
    throw new Error('A CSV can contain up to 10,000 rows.');
  const names = new Set<string>();
  const columns = header.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    if (base.length > 200)
      throw new Error(
        `Column ${index + 1} has a name longer than 200 characters.`
      );
    let name = base;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      const ending = ` ${suffix++}`;
      name = `${base.slice(0, 200 - ending.length)}${ending}`;
    }
    names.add(name.toLocaleLowerCase());
    return name;
  });
  return {
    columns,
    rows: rows.map((row, index) => {
      if (row.length > columns.length)
        throw new Error(`Row ${index + 2} has more values than the header.`);
      return columns.map((_, column) => row[column] ?? '');
    }),
  };
}

/** Papa Parse handles quoting, line endings, and formula-safe text exports. */
export function encodeDatabaseCsv(
  columns: string[],
  rows: (string | number | null)[][]
): string {
  return Papa.unparse(
    { fields: columns, data: rows },
    {
      newline: '\n',
      escapeFormulae: /^[\s]*[=+\-@\t\r]/,
    }
  );
}
