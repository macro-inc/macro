export type QueryDefinition = {
  databaseId?: string;
  sql: string;
  prompt: string;
  displayMode: 'scalar' | 'table';
};

export type QuerySchema = {
  databaseId: string;
  name: string;
  tables: {
    id: string;
    name: string;
    sqlName: string;
    columns: {
      name: string;
      sqlName: string;
      type: string;
      options: string[];
      multiple: boolean;
    }[];
  }[];
};

export type QueryProposal = { sql: string; explanation: string };
export type QueryResult = {
  columns: { name: string; entity_type: string | null }[];
  rows: (string | number | null)[][];
};
export type QueryAnswer = {
  results: QueryResult[];
  read_tables: string[];
  read_versions: Record<string, number>;
  truncated_tables: string[];
};

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function queryStarters(schema: QuerySchema) {
  const table = schema.tables[0];
  if (!table) return [];
  const name = quoteIdentifier(table.sqlName);
  const starters = [
    {
      label: 'Count records',
      prompt: `How many records are in ${table.name}?`,
      sql: `SELECT COUNT(*) AS "Total records" FROM ${name}`,
    },
    {
      label: 'Preview records',
      prompt: `Show me the records in ${table.name}`,
      sql: `SELECT * FROM ${name} LIMIT 50`,
    },
  ];
  const group = table.columns.find((column) => column.options.length && !column.multiple);
  if (group) {
    const column = quoteIdentifier(group.sqlName);
    starters.push({
      label: `Count by ${group.name.toLowerCase()}`,
      prompt: `How many records have each ${group.name.toLowerCase()}?`,
      sql: `SELECT ${column}, COUNT(*) AS "Records" FROM ${name} GROUP BY ${column} ORDER BY COUNT(*) DESC`,
    });
  }
  return starters;
}

export function isScalarAnswer(answer: QueryAnswer | undefined): boolean {
  return !!answer && answer.results.length === 1 && answer.results[0].columns.length === 1 && answer.results[0].rows.length === 1;
}

export function formatQueryValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'number' ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value) : value;
}

/** An early affordance, not a security boundary: the query endpoint enforces read-only SQL. */
export function looksLikeReadQuery(sql: string): boolean {
  const start = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '').trimStart();
  return /^(SELECT|WITH|EXPLAIN)\b/i.test(start);
}

export function queryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no such table/i.test(message)) return 'This table is no longer available. Choose a database and update the question.';
  if (/no such column/i.test(message)) return 'A property in this question has changed. Try asking again with its current name.';
  if (/read.?only|not authorized|forbidden/i.test(message)) return 'Questions can only read data you have access to. Edit records in the table or board.';
  if (/budget|timed out|timeout|too many/i.test(message)) return 'This question needs less data. Try a narrower question or add a LIMIT in SQL.';
  if (/404|not found/i.test(message)) return 'Live questions are not available on this server yet. Your question has been kept.';
  return message || 'We could not answer that question. Try again.';
}

export function parseQueryProposal(value: unknown): QueryProposal {
  if (typeof value !== 'object' || value === null) throw new Error('AI returned an incomplete question. Try again.');
  const record = value as Record<string, unknown>;
  if (typeof record.sql !== 'string' || !record.sql.trim() || typeof record.explanation !== 'string' || !record.explanation.trim()) {
    throw new Error('AI returned an incomplete question. Try again.');
  }
  const sql = record.sql.trim().replace(/^```(?:sql)?\s*|\s*```$/g, '');
  if (!looksLikeReadQuery(sql)) throw new Error('Ask a question about your data. To make changes, use the table or board.');
  return { sql, explanation: record.explanation.trim() };
}
