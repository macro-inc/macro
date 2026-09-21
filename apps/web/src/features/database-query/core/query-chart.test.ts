import { describe, expect, it } from 'vitest';
import { parseQueryProposal, type QueryAnswer } from './query';
import { parseQueryChart, prepareQueryChart } from './query-chart';

const answer: QueryAnswer = {
  results: [
    {
      columns: [
        { name: 'Month', entity_type: null },
        { name: 'Revenue', entity_type: null },
        { name: 'Cost', entity_type: null },
      ],
      rows: [
        ['Jan', 20, 5],
        ['Feb', null, 10],
        ['Mar', -4, 2],
      ],
    },
  ],
  read_tables: [],
  read_versions: {},
  truncated_tables: [],
};

describe('database chart data', () => {
  it('accepts AI chart settings and rejects incomplete or executable specifications', () => {
    const chart = { x: 'Month', y: ['Revenue', 'Cost'], title: 'Cash flow' };
    expect(
      parseQueryProposal({
        sql: 'SELECT month AS Month, revenue AS Revenue, cost AS Cost FROM finances',
        explanation: 'Monthly totals.',
        displayMode: 'line',
        chart,
      })
    ).toMatchObject({ displayMode: 'line', chart });
    expect(() =>
      parseQueryProposal({
        sql: 'SELECT 1',
        explanation: 'One.',
        displayMode: 'pie',
      })
    ).toThrow('chart settings');
    expect(
      parseQueryChart({ x: 'Month', y: ['Revenue', 'Revenue'] })
    ).toBeUndefined();
    expect(parseQueryChart({ x: 'Month', y: ['Month'] })).toBeUndefined();
    expect(
      parseQueryChart({ x: 'Month', y: ['Revenue'], script: 'alert(1)' })
    ).toEqual({ x: 'Month', y: ['Revenue'] });
  });
  it('preserves missing values as gaps and negative values as numbers', () => {
    const chart = prepareQueryChart(answer, 'line');
    expect(chart.data?.config).toEqual({ x: 'Month', y: ['Revenue', 'Cost'] });
    expect(chart.data?.series[0].values).toEqual([20, null, -4]);
  });
  it('preserves true spacing for numeric and ISO date axes', () => {
    const numeric = {
      ...answer,
      results: [
        {
          ...answer.results[0],
          rows: [
            [1, 2, 3],
            [10, 20, 30],
          ],
        },
      ],
    };
    expect(prepareQueryChart(numeric, 'line').data?.positions).toEqual([1, 10]);
    const dates = {
      ...answer,
      results: [
        {
          ...answer.results[0],
          rows: [
            ['2026-01-01', 2, 3],
            ['2026-01-04', 20, 30],
          ],
        },
      ],
    };
    expect(prepareQueryChart(dates, 'line').data?.positions).toEqual([
      Date.parse('2026-01-01'),
      Date.parse('2026-01-04'),
    ]);
    expect(prepareQueryChart(answer, 'line').data?.positions).toBeUndefined();
  });
  it('refuses missing or ambiguous aliases and text values instead of drawing a misleading chart', () => {
    expect(
      prepareQueryChart(answer, 'bar', { x: 'Month', y: ['Profit'] }).error
    ).toContain('unavailable');
    const ambiguous = {
      ...answer,
      results: [
        {
          ...answer.results[0],
          columns: [
            { name: 'Month', entity_type: null },
            { name: 'Revenue', entity_type: null },
            { name: 'Revenue', entity_type: null },
          ],
        },
      ],
    };
    expect(
      prepareQueryChart(ambiguous, 'bar', { x: 'Month', y: ['Revenue'] }).error
    ).toContain('unavailable');
    const text = {
      ...answer,
      results: [{ ...answer.results[0], rows: [['Jan', 'high', 1]] }],
    };
    expect(
      prepareQueryChart(text, 'bar', { x: 'Month', y: ['Revenue'] }).error
    ).toContain('numeric');
  });
  it('rejects invalid pie distributions and never silently truncates chart data', () => {
    expect(prepareQueryChart(answer, 'pie').error).toContain('nonnegative');
    const zeroes = {
      ...answer,
      results: [{ ...answer.results[0], rows: [['Jan', 0, 0]] }],
    };
    expect(prepareQueryChart(zeroes, 'pie').error).toContain(
      'greater than zero'
    );
    const many = {
      ...answer,
      results: [
        {
          ...answer.results[0],
          rows: Array.from({ length: 21 }, (_, index) => [String(index), 1, 2]),
        },
      ],
    };
    expect(prepareQueryChart(many, 'pie').error).toContain('20 categories');
    expect(prepareQueryChart(many, 'bar').data?.labels).toHaveLength(21);
  });
});
