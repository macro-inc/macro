// Daily CI report from the exporter's Loki events: wall time by PR type, what held
// pushes up, slowest jobs and steps, queues, cache volumes and CI hours. The Macro CI
// dashboard reads the same queries from nixos/ci-report.json.
//
// GRAFANA_TOKEN=$(cat <token file>) bun infra/stacks/observability/scripts/ci-report.ts [--range 24h] [--days 7]
// Pass --loki <url> to query another Loki API root, such as a local one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOSTED_LOKI =
  'https://grafana.macro-internal.com/api/datasources/proxy/uid/loki';
const TIMEOUT_MILLISECONDS = 30_000;
const DAY_SECONDS = 86_400;

export type Column = { name: string; unit: string; expr: string };
export type Table = {
  id: string;
  title: string;
  description: string;
  by: string[];
  sort?: string;
  limit?: number;
  columns: Column[];
};
export type Spec = { filters: Record<string, string>; tables: Table[] };
export type Sample = { metric: Record<string, string>; value: number };
export type Row = { labels: string[]; values: (number | null)[] };

/** Replace `$NAME` with its filter and `$RANGE` with the window, as the dashboard does. */
export function expand(
  expr: string,
  filters: Record<string, string>,
  range: string
): string {
  let result = expr.replaceAll('$RANGE', range);
  // Longest names first, so a name that prefixes another can't replace part of it.
  for (const name of Object.keys(filters).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(`$${name}`, filters[name]);
  }
  return result;
}

/** One row per label combination, with a value per column; missing values stay null. */
export function joinColumns(table: Table, results: Sample[][]): Row[] {
  const rows = new Map<string, Row>();
  for (const [index, samples] of results.entries()) {
    for (const sample of samples) {
      const labels = table.by.map((label) => sample.metric[label] ?? '');
      const key = JSON.stringify(labels);
      let row = rows.get(key);
      if (!row) {
        row = { labels, values: table.columns.map(() => null) };
        rows.set(key, row);
      }
      row.values[index] = sample.value;
    }
  }
  const sortIndex = table.columns.findIndex(
    (column) => column.name === table.sort
  );
  const ordered = [...rows.values()];
  if (sortIndex >= 0) {
    ordered.sort(
      (a, b) => (b.values[sortIndex] ?? -1) - (a.values[sortIndex] ?? -1)
    );
  }
  return table.limit ? ordered.slice(0, table.limit) : ordered;
}

export function formatValue(value: number | null, unit: string): string {
  if (value === null || Number.isNaN(value)) return '';
  if (unit === 's') {
    const total = Math.round(value);
    return total < 60
      ? `${total}s`
      : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
  }
  if (unit === 'h') return `${value.toFixed(1)} h`;
  if (unit === 'percentunit') return `${Math.round(value * 100)}%`;
  return String(Math.round(value));
}

export function renderTable(
  table: Table,
  rows: Row[],
  labelHeaders: string[] = table.by
): string {
  const header = [
    ...labelHeaders,
    ...table.columns.map((column) => column.name),
  ];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, index) => (index < labelHeaders.length ? '---' : '---:')).join(' | ')} |`,
  ];
  for (const row of rows) {
    const cells = [
      ...row.labels.map((label) => label || '(none)'),
      ...row.values.map((value, index) =>
        formatValue(value, table.columns[index].unit)
      ),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  if (rows.length === 0) lines.push(`| ${header.map(() => '').join(' | ')} |`);
  return lines.join('\n');
}

/** A Loki duration such as `24h` or `7d`, in seconds. */
export function parseRange(range: string): number {
  const match = /^(\d+)([mhd])$/.exec(range);
  if (!match)
    throw new Error(`Expected a range such as 24h or 7d, got ${range}`);
  return (
    Number(match[1]) *
    { m: 60, h: 3600, d: DAY_SECONDS }[match[2] as 'm' | 'h' | 'd']
  );
}

type LokiVector = {
  status: string;
  data: {
    resultType: string;
    result: { metric: Record<string, string>; value: [number, string] }[];
  };
};

class Loki {
  base: string;
  token: string | undefined;

  constructor(base: string, token: string | undefined) {
    this.base = base;
    this.token = token;
  }

  async instant(query: string, time: number): Promise<Sample[]> {
    const url = `${this.base}/loki/api/v1/query?${new URLSearchParams({ query, time: String(time) })}`;
    const response = await fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) {
      // The body names the query problem; it never echoes the token.
      throw new Error(
        `Loki answered HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`
      );
    }
    const body = (await response.json()) as LokiVector;
    if (body.data.resultType !== 'vector') return [];
    return body.data.result.map((entry) => ({
      metric: entry.metric,
      value: Number(entry.value[1]),
    }));
  }

  async table(
    spec: Spec,
    table: Table,
    range: string,
    time: number
  ): Promise<Row[]> {
    const results = await Promise.all(
      table.columns.map((column) =>
        this.instant(expand(column.expr, spec.filters, range), time)
      )
    );
    return joinColumns(table, results);
  }
}

function argument(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function utc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export async function main(args: string[]) {
  const spec: Spec = JSON.parse(
    readFileSync(new URL('../nixos/ci-report.json', import.meta.url), 'utf8')
  );
  const range = argument(args, '--range', '24h');
  const days = Number(argument(args, '--days', '7'));
  const base = argument(args, '--loki', HOSTED_LOKI);
  const token = process.env.GRAFANA_TOKEN;
  if (base === HOSTED_LOKI && !token) {
    throw new Error(
      'Set GRAFANA_TOKEN to a Grafana token that can read the Loki datasource'
    );
  }
  const loki = new Loki(base, token);
  const now = Math.floor(Date.now() / 1000);
  const output = [
    `# CI report, ${utc(now - parseRange(range))} to ${utc(now)} UTC`,
  ];
  for (const table of spec.tables) {
    output.push(`\n## ${table.title}\n\n${table.description}\n`);
    output.push(renderTable(table, await loki.table(spec, table, range, now)));
  }
  const summary = spec.tables.find((table) => table.id === 'summary');
  if (summary && days > 0) {
    const today = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
    const rows: Row[] = [];
    for (let day = days - 1; day >= 0; day -= 1) {
      const start = today - day * DAY_SECONDS;
      const end = Math.min(start + DAY_SECONDS, now);
      const [row] = await loki.table(spec, summary, `${end - start}s`, end);
      rows.push({
        labels: [
          utc(start).slice(0, 10) +
            (end < start + DAY_SECONDS ? ' (so far)' : ''),
        ],
        values: row?.values ?? summary.columns.map(() => null),
      });
    }
    output.push(`\n## Per UTC day\n`);
    output.push(renderTable(summary, rows, ['Day']));
  }
  console.log(output.join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
