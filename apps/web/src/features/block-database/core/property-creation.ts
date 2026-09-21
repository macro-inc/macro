export type DatabasePropertyType =
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'SELECT_STRING'
  | 'LINK';

export const DATABASE_PROPERTY_TYPES: {
  type: DatabasePropertyType;
  label: string;
  description: string;
  example: string;
}[] = [
  {
    type: 'STRING',
    label: 'Text',
    description: 'Names, notes, and descriptions',
    example: 'e.g. Name',
  },
  {
    type: 'SELECT_STRING',
    label: 'Select',
    description: 'A status or category with named options',
    example: 'e.g. Status',
  },
  {
    type: 'NUMBER',
    label: 'Number',
    description: 'Amounts, counts, and estimates',
    example: 'e.g. Budget',
  },
  {
    type: 'DATE',
    label: 'Date',
    description: 'Due dates and milestones',
    example: 'e.g. Due date',
  },
  {
    type: 'BOOLEAN',
    label: 'Checkbox',
    description: 'A simple yes or no',
    example: 'e.g. Approved',
  },
  {
    type: 'LINK',
    label: 'URL',
    description: 'A link to a website',
    example: 'e.g. Website',
  },
];

/** Select labels are trimmed and case-insensitively unique, matching the API. */
export function parseDatabaseOptionLabels(text: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const label = raw.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export function isDatabaseNameTaken(
  name: string,
  names: readonly string[]
): boolean {
  const candidate = name.trim().toLocaleLowerCase();
  return names.some(
    (existing) => existing.trim().toLocaleLowerCase() === candidate
  );
}

export function defaultDatabaseColumnName(names: readonly string[]): string {
  let name = 'Unnamed';
  let suffix = 2;
  while (isDatabaseNameTaken(name, names)) name = `Unnamed ${suffix++}`;
  return name;
}
