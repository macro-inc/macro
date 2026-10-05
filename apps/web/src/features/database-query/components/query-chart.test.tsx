import type {
  DatabaseQueryChart,
  DatabaseQueryChartMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { render, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { unknownNames } from '../core/answer-cell';
import type { QueryAnswer } from '../core/query';
import { prepareQueryChart } from '../core/query-chart';
import { QueryChart } from './query-chart';

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: () => ({ width: 346, height: 300 }),
}));

const answer: QueryAnswer = {
  columns: [
    { name: 'Day', kind: 'date' },
    { name: 'Signups', kind: 'number' },
    { name: 'Churn', kind: 'number' },
  ],
  rows: [
    [
      { type: 'date', value: '2026-01-01T00:00:00Z' },
      { type: 'number', value: 2 },
      { type: 'number', value: 1 },
    ],
    [
      { type: 'date', value: '2026-01-04T00:00:00Z' },
      { type: 'number', value: 20 },
      { type: 'number', value: 3 },
    ],
    [
      { type: 'date', value: '2026-02-10T00:00:00Z' },
      { type: 'number', value: 12 },
      { type: 'number', value: 2 },
    ],
  ],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};

function chartData(mode: DatabaseQueryChartMode, config: DatabaseQueryChart) {
  const prepared = prepareQueryChart(answer, mode, config, unknownNames);
  if (!prepared.data) throw new Error(prepared.error);
  return prepared.data;
}

describe('database chart', () => {
  it.each([
    ['bar', 'bar'],
    ['line', 'line'],
    ['area', 'area'],
    ['scatter', 'dot'],
  ] as const)(
    'draws a %s chart as Plot %s marks in an SVG',
    async (mode, mark) => {
      const rendered = render(() => (
        <QueryChart data={chartData(mode, { x: 'Day', y: ['Signups'] })} />
      ));
      const chart = rendered.getByRole('img', {
        name: new RegExp(`^Signups by Day\\. ${mode} chart\\.$`, 'i'),
      });
      await waitFor(() =>
        expect(chart.querySelector(`svg g[aria-label="${mark}"]`)).toBeTruthy()
      );
      expect(chart.querySelectorAll('svg').length).toBe(1);
      rendered.unmount();
    }
  );

  it('holds the chart’s height while Plot loads', () => {
    const rendered = render(() => (
      <QueryChart data={chartData('line', { x: 'Day', y: ['Signups'] })} />
    ));
    const chart = rendered.getByRole('img');
    expect(chart.getAttribute('aria-busy')).toBe('true');
    expect(chart.style.height).toBe('240px');
    rendered.unmount();
  });

  it('adds a color legend when there are several series', async () => {
    const rendered = render(() => (
      <QueryChart
        data={chartData('line', { x: 'Day', y: ['Signups', 'Churn'] })}
      />
    ));
    await waitFor(() =>
      expect(
        Array.from(
          rendered.container.querySelectorAll('.macro-chart-swatch'),
          (swatch) => swatch.textContent
        )
      ).toEqual(['Signups', 'Churn'])
    );
    rendered.unmount();
  });

  it('still draws a pie, labelling the slices that have room', () => {
    const shares: QueryAnswer = {
      ...answer,
      columns: [
        { name: 'Status', kind: 'text' },
        { name: 'Count', kind: 'number' },
      ],
      rows: [
        [
          { type: 'text', value: 'Todo' },
          { type: 'number', value: 6 },
        ],
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value: 3 },
        ],
        [
          { type: 'text', value: 'Blocked' },
          { type: 'number', value: 0.1 },
        ],
      ],
    };
    const prepared = prepareQueryChart(shares, 'pie', undefined, unknownNames);
    if (!prepared.data) throw new Error(prepared.error);
    const data = prepared.data;
    const rendered = render(() => <QueryChart data={data} />);
    const chart = rendered.getByRole('img', {
      name: 'Count by Status. Pie chart.',
    });
    const slices = chart.querySelectorAll('svg path[data-slice]');
    expect(slices.length).toBe(3);
    expect(
      Array.from(slices).map((slice) => slice.getAttribute('fill'))
    ).toEqual([
      'var(--color-blue)',
      'var(--color-orange)',
      'var(--color-teal)',
    ]);
    expect(
      Array.from(chart.querySelectorAll('svg text')).map(
        (label) => label.textContent
      )
    ).toEqual(['Todo6', 'Done3']);
    expect(rendered.getByText('Blocked')).toBeTruthy();
    rendered.unmount();
  });
});
