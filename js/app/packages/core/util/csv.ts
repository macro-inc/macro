type CsvParseResult<TRecord extends Record<string, string>> =
  | {
      ok: true;
      headers: readonly string[];
      records: readonly TRecord[];
    }
  | {
      ok: false;
      error: string;
    };

function normalizeNewlines(text: string): string {
  // Normalize Windows newlines to Unix so we only have to handle \n.
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * Parse a CSV string supporting:
 * - Comma delimiters
 * - Double-quoted fields (with escaped quotes via "" inside quoted fields)
 * - Newlines inside quoted fields
 *
 * This is intentionally small + dependency-free for environments where we
 * can't add new packages.
 */
export function parseCsv(
  csvText: string
): CsvParseResult<Record<string, string>> {
  const text = normalizeNewlines(csvText);
  if (!text.trim()) return { ok: false, error: 'CSV is empty' };

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }

      field += ch;
      continue;
    }

    if (ch === '"') {
      // Start of quoted field.
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      field = '';
      // Skip trailing completely-empty rows (e.g. final newline).
      if (!(row.length === 1 && row[0] === '' && rows.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  if (inQuotes) return { ok: false, error: 'CSV has an unterminated quote' };

  // Flush the last field/row (common when file does not end with newline).
  row.push(field);
  if (!(row.length === 1 && row[0] === '' && rows.length > 0)) {
    rows.push(row);
  }

  const headerRow = rows[0];
  if (!headerRow || headerRow.length === 0) {
    return { ok: false, error: 'CSV is missing a header row' };
  }

  const headers = headerRow.map((h) => h.trim());
  if (headers.some((h) => h.length === 0)) {
    return { ok: false, error: 'CSV contains an empty header column' };
  }

  const dataRows = rows.slice(1);
  const records: Record<string, string>[] = [];
  for (const r of dataRows) {
    // Pad short rows and ignore extra columns.
    const padded = [...r];
    while (padded.length < headers.length) padded.push('');

    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i] ?? ''] = padded[i] ?? '';
    }
    records.push(record);
  }

  return { ok: true, headers, records };
}
