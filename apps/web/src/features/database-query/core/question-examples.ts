import type { QuerySchema } from './query';

/** Examples use actual selected column names; Automatic can discover any source. */
export function questionExamples(schema: QuerySchema): string[] {
  if (!schema.databaseId)
    return [
      'In the customers database, list customers by how long they’ve been around',
      'Show open tickets grouped by priority',
      'Chart revenue by month',
    ];
  const table =
    schema.tables.find((entry) => entry.id === schema.focusTableId) ??
    schema.tables.find((entry) => !entry.id.startsWith('platform:'));
  if (!table) return ['Ask anything about your data…'];
  const examples = [
    `How many records are in ${table.name}?`,
    `Show me ${table.name}`,
  ];
  const category = table.columns.find((column) => column.options.length > 0);
  const date = table.columns.find(
    (column) => column.type.toLowerCase() === 'date'
  );
  if (category) examples.push(`Chart ${table.name} by ${category.name}`);
  if (date) examples.push(`List ${table.name} ordered by ${date.name}`);
  return examples;
}
