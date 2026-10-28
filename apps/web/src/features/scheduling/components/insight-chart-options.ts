import type { PlotOptions } from '@observablehq/plot';
import type { InsightDay, InsightMetric } from '../core/insights';
import type { InsightPlotModule } from './insight-plot';

export type InsightSeries = {
  key: InsightMetric;
  label: string;
  color: string;
};

const TIP = {
  fill: 'var(--color-menu)',
  stroke: 'var(--color-edge)',
  fontSize: 12,
};
const integerTick = (value: number) =>
  Number.isInteger(value) ? value.toLocaleString() : '';
const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(date);
export const hourLabel = (hour: number) =>
  `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;

export function trendPlot(
  Plot: InsightPlotModule,
  width: number,
  days: InsightDay[],
  series: InsightSeries[]
): PlotOptions {
  const data = days.flatMap((day) =>
    series.map((item) => ({
      date: new Date(`${day.date}T00:00:00Z`),
      count: day[item.key],
      series: item.label,
      tip: [
        dateLabel(new Date(`${day.date}T00:00:00Z`)),
        ...series.map((item) => `${item.label}: ${day[item.key]}`),
      ].join('\n'),
    }))
  );
  const domain = days.map((day) => new Date(`${day.date}T00:00:00Z`));
  return {
    width,
    height: 280,
    marginLeft: 40,
    marginRight: 18,
    marginBottom: 42,
    x: {
      type: 'utc',
      label: 'Booking start date',
      domain:
        domain.length === 1
          ? [
              new Date(+domain[0] - 43_200_000),
              new Date(+domain[0] + 43_200_000),
            ]
          : domain.length
            ? [domain[0], domain.at(-1)!]
            : undefined,
      ticks: days.length <= 7 ? domain : Math.max(2, Math.floor(width / 110)),
      tickFormat: dateLabel,
    },
    y: {
      label: null,
      grid: true,
      domain: [0, Math.max(4, ...data.map((point) => point.count))],
      ticks: 4,
      tickFormat: integerTick,
    },
    color: {
      domain: series.map((item) => item.label),
      range: series.map((item) => item.color),
      legend: false,
    },
    marks: [
      Plot.ruleY([0], { stroke: 'var(--color-edge)' }),
      Plot.lineY(data, {
        x: 'date',
        y: 'count',
        stroke: 'series',
        strokeWidth: 2,
      }),
      ...(days.length <= 31
        ? [
            Plot.dot(data, {
              x: 'date',
              y: 'count',
              stroke: 'series',
              fill: 'var(--color-panel)',
              r: 3,
            }),
          ]
        : []),
      Plot.ruleX(
        data,
        Plot.pointerX({ x: 'date', stroke: 'var(--color-edge)' })
      ),
      Plot.tip(
        data,
        Plot.pointerX({ x: 'date', y: 'count', title: 'tip', ...TIP })
      ),
    ],
  };
}

export function hourPlot(
  Plot: InsightPlotModule,
  width: number,
  hours: number[]
): PlotOptions {
  const data = hours.map((count, hour) => ({
    hour,
    count,
    tip: `${hourLabel(hour)}: ${count} ${count === 1 ? 'booking' : 'bookings'}`,
  }));
  return {
    width,
    height: 200,
    marginLeft: 32,
    marginRight: 8,
    marginBottom: 30,
    x: {
      type: 'band',
      label: null,
      domain: Array.from({ length: 24 }, (_, hour) => hour),
      ticks: [0, 6, 12, 18, 23],
      tickFormat: hourLabel,
      tickSize: 0,
    },
    y: {
      label: null,
      domain: [0, Math.max(1, ...hours)],
      grid: true,
      ticks: 3,
      tickFormat: integerTick,
    },
    marks: [
      Plot.barY(data, {
        x: 'hour',
        y: 'count',
        fill: 'var(--color-ink-muted)',
        rx: 3,
        inset: 1,
        title: 'tip',
        tip: TIP,
      }),
      Plot.ruleY([0], { stroke: 'var(--color-edge)' }),
    ],
  };
}
