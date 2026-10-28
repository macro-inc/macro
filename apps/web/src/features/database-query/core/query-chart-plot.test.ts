import type {
  DatabaseQueryChart,
  DatabaseQueryChartMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { describe, expect, it } from 'vitest';
import { unknownNames } from './answer-cell';
import type { QueryAnswer } from './query';
import { prepareQueryChart } from './query-chart';
import { CHART_TIP, plotChart } from './query-chart-plot';

const palette = ['one', 'two', 'three'];

const status: QueryAnswer = {
  columns: [
    { name: 'Status', kind: 'text' },
    { name: 'Count', kind: 'number' },
    { name: 'Hours', kind: 'number' },
  ],
  rows: [
    [
      { type: 'text', value: 'Todo' },
      { type: 'number', value: 3 },
      { type: 'number', value: 12 },
    ],
    [
      { type: 'text', value: 'Done' },
      { type: 'number', value: 2 },
      { type: 'number', value: 30 },
    ],
  ],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};

const daily: QueryAnswer = {
  ...status,
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
};

function chartData(
  answer: QueryAnswer,
  mode: DatabaseQueryChartMode,
  config: DatabaseQueryChart
) {
  const prepared = prepareQueryChart(answer, mode, config, unknownNames);
  if (!prepared.data) throw new Error(prepared.error);
  return prepared.data;
}

function formatter(format: unknown) {
  if (typeof format !== 'function') throw new Error('Expected a tick format');
  return format as (value: unknown) => string;
}

describe('chart spec to Plot options', () => {
  it('draws an old saved bar chart as horizontal bars over its categories', () => {
    const data = chartData(status, 'bar', { x: 'Status', y: ['Count'] });
    expect(plotChart(data, { width: 400, palette })).toEqual({
      className: 'macro-chart',
      width: 400,
      height: 96,
      marginTop: 8,
      marginRight: 16,
      marginBottom: 24,
      marginLeft: 48,
      style: {
        fontFamily: 'inherit',
        fontSize: '11px',
        color: 'var(--color-ink-muted)',
        background: 'transparent',
        overflow: 'visible',
      },
      x: {
        label: null,
        grid: true,
        nice: true,
        ticks: 4,
        tickFormat: expect.any(Function),
      },
      y: {
        label: null,
        domain: ['Todo', 'Done'],
        padding: 0.3,
        tickSize: 0,
        tickPadding: 8,
        tickFormat: expect.any(Function),
      },
      color: {
        domain: ['Count'],
        range: ['one'],
        legend: false,
        style: {
          fontFamily: 'inherit',
          fontSize: '11px',
          color: 'var(--color-ink-muted)',
          marginBottom: '4px',
        },
      },
      marks: [
        {
          mark: 'barX',
          data: data.points,
          options: {
            x: 'value',
            y: 'label',
            fill: 'series',
            rx: 2,
            title: 'tip',
            tip: CHART_TIP,
          },
        },
        { mark: 'ruleX', data: [0], options: { stroke: 'var(--color-edge)' } },
      ],
    });
  });

  it('groups several series within each category and stacks them on request', () => {
    const grouped = chartData(status, 'bar', {
      x: 'Status',
      y: ['Count', 'Hours'],
    });
    const groupedChart = plotChart(grouped, { width: 400, palette });
    expect(groupedChart.height).toBe(2 * (2 * 14 + 14) + 32);
    expect(groupedChart.color).toMatchObject({
      domain: ['Count', 'Hours'],
      range: ['one', 'two'],
      legend: true,
    });
    expect(groupedChart.fy).toEqual({
      label: null,
      domain: ['Todo', 'Done'],
      padding: 0.2,
      tickSize: 0,
      tickPadding: 8,
      tickFormat: expect.any(Function),
    });
    expect(groupedChart.y).toEqual({
      axis: null,
      domain: ['Count', 'Hours'],
      padding: 0.1,
    });
    expect(groupedChart.marks[0]).toEqual({
      mark: 'barX',
      data: grouped.points,
      options: {
        x: 'value',
        y: 'series',
        fy: 'label',
        fill: 'series',
        rx: 2,
        title: 'tip',
        tip: CHART_TIP,
      },
    });

    const stacked = chartData(status, 'bar', {
      x: 'Status',
      y: ['Count', 'Hours'],
      stack: true,
    });
    const stackedChart = plotChart(stacked, { width: 400, palette });
    expect(stackedChart.fy).toBeUndefined();
    expect(stackedChart.marks[0]).toEqual({
      mark: 'barX',
      data: stacked.points,
      options: {
        x: 'value',
        y: 'label',
        fill: 'series',
        stroke: 'var(--color-panel)',
        strokeWidth: 1,
        title: 'tip',
        tip: CHART_TIP,
      },
    });
  });

  it('draws bars over dates as columns in row order', () => {
    const data = chartData(daily, 'bar', { x: 'Day', y: ['Signups'] });
    const chart = plotChart(data, { width: 400, palette });
    expect(chart.height).toBe(240);
    expect(chart.x).toEqual({
      label: null,
      domain: ['Jan 1, 2026', 'Jan 4, 2026', 'Feb 10, 2026'],
      padding: 0.2,
      tickSize: 0,
      tickFormat: expect.any(Function),
    });
    expect(chart.marks).toEqual([
      {
        mark: 'barY',
        data: data.points,
        options: {
          x: 'label',
          y: 'value',
          fill: 'series',
          rx: 2,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
      { mark: 'ruleY', data: [0], options: { stroke: 'var(--color-edge)' } },
    ]);
  });

  it('draws a line over a time axis with a marker at each point', () => {
    const data = chartData(daily, 'line', {
      x: 'Day',
      y: ['Signups', 'Churn'],
    });
    const chart = plotChart(data, { width: 400, palette });
    expect(chart).toMatchObject({
      height: 240,
      marginTop: 12,
      marginRight: 16,
      marginBottom: 28,
      marginLeft: 36,
      x: { type: 'time', label: null, nice: true, ticks: 3 },
      y: { label: null, grid: true, nice: true, ticks: 5 },
      color: {
        domain: ['Signups', 'Churn'],
        range: ['one', 'two'],
        legend: true,
      },
    });
    expect(chart.marks).toEqual([
      {
        mark: 'lineY',
        data: data.points,
        options: {
          x: 'x',
          y: 'value',
          z: 'series',
          stroke: 'series',
          strokeWidth: 2,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
      {
        mark: 'dot',
        data: data.points,
        options: { x: 'x', y: 'value', fill: 'series', r: 3 },
      },
    ]);
    expect(formatter(chart.x?.tickFormat)(new Date(2026, 1, 10))).toBe(
      'Feb 10'
    );
    // A rounded axis end in the next year says which year it is.
    expect(formatter(chart.x?.tickFormat)(new Date(2027, 0, 1))).toBe(
      'Jan 1, 2027'
    );
  });

  it('draws areas from zero, overlapping unless stacked', () => {
    const overlap = chartData(daily, 'area', {
      x: 'Day',
      y: ['Signups', 'Churn'],
    });
    expect(plotChart(overlap, { width: 400, palette }).marks).toEqual([
      {
        mark: 'areaY',
        data: overlap.points,
        options: {
          x: 'x',
          y1: 0,
          y2: 'value',
          z: 'series',
          fill: 'series',
          fillOpacity: 0.16,
        },
      },
      {
        mark: 'lineY',
        data: overlap.points,
        options: {
          x: 'x',
          y: 'value',
          z: 'series',
          stroke: 'series',
          strokeWidth: 2,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
      {
        mark: 'dot',
        data: overlap.points,
        options: { x: 'x', y: 'value', fill: 'series', r: 3 },
      },
      { mark: 'ruleY', data: [0], options: { stroke: 'var(--color-edge)' } },
    ]);
    const stacked = chartData(daily, 'area', {
      x: 'Day',
      y: ['Signups', 'Churn'],
      stack: true,
    });
    expect(plotChart(stacked, { width: 400, palette }).marks).toEqual([
      {
        mark: 'areaY',
        data: stacked.points,
        options: {
          x: 'x',
          y: 'value',
          z: 'series',
          fill: 'series',
          fillOpacity: 0.85,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
      { mark: 'ruleY', data: [0], options: { stroke: 'var(--color-edge)' } },
    ]);
  });

  it('draws a scatter as dots on numeric axes', () => {
    const data = chartData(status, 'scatter', { x: 'Count', y: ['Hours'] });
    const chart = plotChart(data, { width: 400, palette });
    expect(chart.x).toEqual({
      label: null,
      nice: true,
      ticks: 4,
      tickFormat: expect.any(Function),
    });
    expect(chart.marks).toEqual([
      {
        mark: 'dot',
        data: data.points,
        options: {
          x: 'x',
          y: 'value',
          fill: 'series',
          r: 4,
          fillOpacity: 0.85,
          stroke: 'var(--color-panel)',
          strokeWidth: 1,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
    ]);
  });

  it('formats ticks the way the grid formats values', () => {
    const big: QueryAnswer = {
      ...status,
      rows: [
        [
          { type: 'text', value: 'Todo' },
          { type: 'number', value: 1200 },
          { type: 'number', value: 12 },
        ],
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value: 25000 },
          { type: 'number', value: 30 },
        ],
      ],
    };
    const small = plotChart(
      chartData(status, 'line', { x: 'Status', y: ['Hours'] }),
      { width: 400, palette }
    );
    expect(formatter(small.y?.tickFormat)(1500)).toBe('1,500');
    const compact = plotChart(
      chartData(big, 'line', { x: 'Status', y: ['Count'] }),
      { width: 400, palette }
    );
    expect(formatter(compact.y?.tickFormat)(25000)).toBe('25K');
    const years = plotChart(
      chartData(
        {
          ...daily,
          rows: [
            [
              { type: 'date', value: '2025-12-30T00:00:00Z' },
              { type: 'number', value: 2 },
              { type: 'number', value: 1 },
            ],
            [
              { type: 'date', value: '2026-01-04T00:00:00Z' },
              { type: 'number', value: 20 },
              { type: 'number', value: 3 },
            ],
          ],
        },
        'line',
        { x: 'Day', y: ['Signups'] }
      ),
      { width: 400, palette }
    );
    expect(formatter(years.x?.tickFormat)(new Date(2026, 0, 4))).toBe(
      'Jan 4, 2026'
    );
  });

  it('truncates long category labels to the room beside the bars', () => {
    const long: QueryAnswer = {
      ...status,
      rows: [
        [
          { type: 'text', value: 'A very long status name that keeps going' },
          { type: 'number', value: 3 },
          { type: 'number', value: 1 },
        ],
        [
          { type: 'text', value: 'Done' },
          { type: 'number', value: 2 },
          { type: 'number', value: 1 },
        ],
      ],
    };
    const chart = plotChart(
      chartData(long, 'bar', { x: 'Status', y: ['Count'] }),
      { width: 300, palette }
    );
    expect(chart.marginLeft).toBe(120);
    expect(
      formatter(chart.y?.tickFormat)('A very long status name that keeps going')
    ).toBe('A very long stat…');
    expect(formatter(chart.y?.tickFormat)('Done')).toBe('Done');
  });

  it('rotates column labels that would collide', () => {
    const crowded: QueryAnswer = {
      ...daily,
      rows: Array.from({ length: 12 }, (_, day) => [
        { type: 'date', value: `2026-03-${String(day + 10)}T00:00:00Z` },
        { type: 'number', value: day },
        { type: 'number', value: 1 },
      ]),
    };
    const chart = plotChart(
      chartData(crowded, 'bar', { x: 'Day', y: ['Signups'] }),
      { width: 400, palette }
    );
    expect(chart.x).toMatchObject({ tickRotate: -35 });
    expect(chart.marginBottom).toBe(60);
  });
});
