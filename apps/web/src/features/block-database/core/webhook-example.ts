import { match } from 'ts-pattern';
import type { DatabaseViewColumn } from '../../database/core/database-view';

type ExampleValue = string | number | boolean | string[] | null;

/**
 * A payload a webhook would accept for the table: every column by name, with
 * a value of its type, or `null` where a real value needs an id the sender
 * has to supply (references and relations) or the column has no options yet.
 */
export function webhookExamplePayload(
  columns: DatabaseViewColumn[],
  today: string
): Record<string, ExampleValue> {
  return Object.fromEntries(
    columns.map((column) => [column.name, exampleValue(column, today)])
  );
}

function exampleValue(column: DatabaseViewColumn, today: string): ExampleValue {
  if (column.relation) return null;
  return match(column.dataType)
    .returnType<ExampleValue>()
    .with('STRING', () => 'Text')
    .with('NUMBER', () => 1)
    .with('BOOLEAN', () => true)
    .with('DATE', () => today)
    .with('LINK', () => 'https://example.com')
    .with('SELECT_STRING', 'SELECT_NUMBER', 'TAG', () => {
      const label = column.options[0]?.label;
      if (label === undefined) return null;
      return column.isMultiSelect || column.dataType === 'TAG'
        ? [label]
        : label;
    })
    .with('ENTITY', () => null)
    .exhaustive();
}

/** A `curl` that posts the payload to the webhook. */
export function webhookCurl(url: string, payload: object): string {
  const body = JSON.stringify(payload, null, 2).replaceAll("'", "'\\''");
  return `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
}
