import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  expand,
  formatValue,
  joinColumns,
  parseRange,
  renderTable,
  type Spec,
  type Table,
} from './ci-report';

const spec: Spec = JSON.parse(
  readFileSync(new URL('../nixos/ci-report.json', import.meta.url), 'utf8')
);

const table: Table = {
  id: 'jobs',
  title: 'Jobs',
  description: '',
  by: ['workflow', 'job'],
  sort: 'p90',
  limit: 2,
  columns: [
    { name: 'Runs', unit: 'short', expr: '' },
    { name: 'p90', unit: 's', expr: '' },
  ],
};

describe('the shared spec', () => {
  test('expands every query to LogQL with no placeholder left', () => {
    for (const entry of spec.tables) {
      for (const column of entry.columns) {
        const query = expand(column.expr, spec.filters, '1d');
        expect(query).not.toContain('$');
        expect(query).toContain('{service_name="ci-telemetry"}');
      }
    }
  });

  test('groups every column by its table labels, so rows join', () => {
    for (const entry of spec.tables) {
      for (const column of entry.columns) {
        const grouping = entry.by.length
          ? `by (${entry.by.join(', ')})`
          : /by \(\)|^sum\(/;
        if (typeof grouping === 'string')
          expect(column.expr).toContain(grouping);
        else expect(column.expr).toMatch(grouping);
      }
    }
  });

  test('sorts by a column it has, and has unique ids', () => {
    for (const entry of spec.tables) {
      if (entry.sort)
        expect(entry.columns.map((column) => column.name)).toContain(
          entry.sort
        );
    }
    const ids = spec.tables.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('summary');
  });
});

test('expand replaces the range and longer names before their prefixes', () => {
  expect(
    expand('$PUSH_X $PUSH [$RANGE]', { PUSH: 'a', PUSH_X: 'b' }, '1d')
  ).toBe('b a [1d]');
});

test('joinColumns joins on labels, sorts, limits and keeps gaps', () => {
  const rows = joinColumns(table, [
    [
      { metric: { workflow: 'W', job: 'a' }, value: 3 },
      { metric: { workflow: 'W', job: 'b' }, value: 5 },
      { metric: { workflow: 'W', job: 'c' }, value: 1 },
    ],
    [
      { metric: { workflow: 'W', job: 'b' }, value: 400 },
      { metric: { workflow: 'W', job: 'c' }, value: 90 },
    ],
  ]);
  expect(rows).toEqual([
    { labels: ['W', 'b'], values: [5, 400] },
    { labels: ['W', 'c'], values: [1, 90] },
  ]);
  expect(
    joinColumns({ ...table, limit: undefined }, [
      [{ metric: { workflow: 'W', job: 'a' }, value: 3 }],
      [],
    ])
  ).toEqual([{ labels: ['W', 'a'], values: [3, null] }]);
});

test('formatValue writes durations, hours and shares', () => {
  expect(formatValue(42.4, 's')).toBe('42s');
  expect(formatValue(387, 's')).toBe('6m 27s');
  expect(formatValue(12.34, 'h')).toBe('12.3 h');
  expect(formatValue(0.826, 'percentunit')).toBe('83%');
  expect(formatValue(null, 's')).toBe('');
});

test('renderTable writes a markdown table with an empty row when there is no data', () => {
  expect(renderTable(table, [{ labels: ['W', ''], values: [2, 61] }])).toBe(
    '| workflow | job | Runs | p90 |\n| --- | --- | ---: | ---: |\n| W | (none) | 2 | 1m 01s |'
  );
  expect(renderTable(table, []).split('\n')).toHaveLength(3);
});

test('parseRange reads Loki durations', () => {
  expect(parseRange('24h')).toBe(86_400);
  expect(parseRange('7d')).toBe(604_800);
  expect(() => parseRange('1w')).toThrow();
});
