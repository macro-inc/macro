/**
 * Chart editing: the chart type gallery, the data editor (a small
 * spreadsheet of categories and series), and the Chart Design tab.
 */

import type {
  ChartGrouping,
  ChartOutline,
  EditableChartKind,
  LegendPosition,
  ShapeOutline,
} from '@core/pptx-engine/types';
import Plus from '@phosphor/plus.svg';
import TableIcon from '@phosphor/table.svg';
import Trash from '@phosphor/trash.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { createSignal, For, Index, type JSX, Show } from 'solid-js';
import { modulate } from '../core/palette';
import {
  PopoverItem,
  PopoverLabel,
  RibbonGroup,
  RibbonPopover,
  RibbonTextButton,
} from './ribbon/controls';
import { useRibbon } from './ribbon/ribbon';

export interface ChartChoice {
  kind: EditableChartKind;
  grouping?: ChartGrouping;
  label: string;
}

export const CHART_CHOICES: { group: string; choices: ChartChoice[] }[] = [
  {
    group: 'Column',
    choices: [
      { kind: 'column', grouping: 'clustered', label: 'Clustered column' },
      { kind: 'column', grouping: 'stacked', label: 'Stacked column' },
      {
        kind: 'column',
        grouping: 'percentStacked',
        label: '100% stacked column',
      },
    ],
  },
  {
    group: 'Bar',
    choices: [
      { kind: 'bar', grouping: 'clustered', label: 'Clustered bar' },
      { kind: 'bar', grouping: 'stacked', label: 'Stacked bar' },
      { kind: 'bar', grouping: 'percentStacked', label: '100% stacked bar' },
    ],
  },
  {
    group: 'Line',
    choices: [
      { kind: 'line', grouping: 'standard', label: 'Line' },
      { kind: 'line', grouping: 'stacked', label: 'Stacked line' },
      { kind: 'line', grouping: 'percentStacked', label: '100% stacked line' },
    ],
  },
  {
    group: 'Area',
    choices: [
      { kind: 'area', grouping: 'standard', label: 'Area' },
      { kind: 'area', grouping: 'stacked', label: 'Stacked area' },
      { kind: 'area', grouping: 'percentStacked', label: '100% stacked area' },
    ],
  },
  {
    group: 'Pie',
    choices: [
      { kind: 'pie', label: 'Pie' },
      { kind: 'doughnut', label: 'Doughnut' },
    ],
  },
];

/** A small drawing of a chart type. */
export function ChartIcon(props: { choice: ChartChoice; class?: string }) {
  const k = () => props.choice.kind;
  const g = () => props.choice.grouping;
  const bars = (horizontal: boolean): JSX.Element => {
    const sets =
      g() === 'stacked' || g() === 'percentStacked'
        ? [
            [9, 5],
            [12, 6],
            [7, 8],
          ]
        : [
            [9, 6],
            [12, 9],
            [6, 11],
          ];
    return (
      <For each={sets}>
        {([a, b], i) => {
          const full = g() === 'percentStacked' ? 14 : undefined;
          const at = 3 + i() * 5;
          if (g() === 'stacked' || g() === 'percentStacked') {
            const total = full ?? a + b;
            const first = full ? (a / (a + b)) * full : a;
            return horizontal ? (
              <>
                <rect
                  x="2"
                  y={at}
                  width={first}
                  height="3"
                  class="fill-accent"
                />
                <rect
                  x={2 + first}
                  y={at}
                  width={total - first}
                  height="3"
                  class="fill-accent/40"
                />
              </>
            ) : (
              <>
                <rect
                  x={at}
                  y={18 - first}
                  width="3"
                  height={first}
                  class="fill-accent"
                />
                <rect
                  x={at}
                  y={18 - total}
                  width="3"
                  height={total - first}
                  class="fill-accent/40"
                />
              </>
            );
          }
          return horizontal ? (
            <>
              <rect x="2" y={at} width={a} height="1.6" class="fill-accent" />
              <rect
                x="2"
                y={at + 1.7}
                width={b}
                height="1.6"
                class="fill-accent/40"
              />
            </>
          ) : (
            <>
              <rect
                x={at}
                y={18 - a}
                width="1.6"
                height={a}
                class="fill-accent"
              />
              <rect
                x={at + 1.7}
                y={18 - b}
                width="1.6"
                height={b}
                class="fill-accent/40"
              />
            </>
          );
        }}
      </For>
    );
  };
  return (
    <svg viewBox="0 0 20 20" class={props.class ?? 'size-5'}>
      <Show when={k() === 'column'}>{bars(false)}</Show>
      <Show when={k() === 'bar'}>{bars(true)}</Show>
      <Show when={k() === 'line'}>
        <polyline
          points="2,14 7,9 11,12 18,4"
          class="fill-none stroke-accent"
          stroke-width="1.6"
        />
        <Show when={g() !== 'standard'}>
          <polyline
            points="2,17 7,14 11,16 18,10"
            class="fill-none stroke-accent/50"
            stroke-width="1.6"
          />
        </Show>
      </Show>
      <Show when={k() === 'area'}>
        <polygon
          points="2,18 2,12 7,8 12,11 18,5 18,18"
          class="fill-accent/40"
        />
        <Show when={g() !== 'standard'}>
          <polygon
            points="2,18 2,15 7,13 12,15 18,11 18,18"
            class="fill-accent"
          />
        </Show>
      </Show>
      <Show when={k() === 'pie'}>
        <circle cx="10" cy="10" r="8" class="fill-accent/40" />
        <path d="M10 10 L10 2 A8 8 0 0 1 17.6 12.5 Z" class="fill-accent" />
      </Show>
      <Show when={k() === 'doughnut'}>
        <circle
          cx="10"
          cy="10"
          r="6"
          class="fill-none stroke-accent/40"
          stroke-width="4"
        />
        <path
          d="M10 4 A6 6 0 0 1 15.7 11.9"
          class="fill-none stroke-accent"
          stroke-width="4"
        />
      </Show>
      <line
        x1="1.5"
        y1="18.5"
        x2="18.5"
        y2="18.5"
        class="stroke-ink-muted"
        stroke-width="0.6"
      />
    </svg>
  );
}

export function ChartGallery(props: {
  current?: ChartOutline;
  onPick: (choice: ChartChoice) => void;
}) {
  return (
    <div class="flex w-64 flex-col gap-1" data-testid="pptx-chart-gallery">
      <For each={CHART_CHOICES}>
        {(group) => (
          <div>
            <PopoverLabel>{group.group}</PopoverLabel>
            <div class="flex gap-1 px-1">
              <For each={group.choices}>
                {(choice) => (
                  <button
                    type="button"
                    title={choice.label}
                    aria-label={choice.label}
                    data-testid={`pptx-chart-${choice.kind}-${choice.grouping ?? 'default'}`}
                    class="flex size-10 items-center justify-center rounded-md border border-edge-muted hover:border-accent hover:bg-ink/5"
                    classList={{
                      'border-accent bg-accent-bg':
                        props.current?.kind === choice.kind &&
                        (props.current.grouping ?? undefined) ===
                          (choice.grouping ?? props.current.grouping),
                    }}
                    onClick={() => props.onPick(choice)}
                  >
                    <ChartIcon choice={choice} class="size-7" />
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

/** Sample data for a new chart, as PowerPoint inserts. */
export function sampleChartData() {
  return {
    categories: ['Category 1', 'Category 2', 'Category 3', 'Category 4'],
    series: [
      { name: 'Series 1', values: [4.3, 2.5, 3.5, 4.5] },
      { name: 'Series 2', values: [2.4, 4.4, 1.8, 2.8] },
      { name: 'Series 3', values: [2, 2, 3, 5] },
    ],
  };
}

/** Parses a typed cell into a number (blank → null). */
function parseNumber(text: string): number | null | undefined {
  const t = text.trim().replace(/,/g, '');
  if (!t) return null;
  const pct = t.endsWith('%');
  const n = Number(pct ? t.slice(0, -1) : t.replace(/^\$/, ''));
  if (!Number.isFinite(n)) return undefined;
  return pct ? n / 100 : n;
}

/**
 * The chart's data as a grid: categories down the first column, series
 * across the first row. Pasting tab-separated cells fills the grid.
 */
export function ChartDataEditor(props: {
  shape: ShapeOutline;
  readonly: boolean;
  onApply: (data: {
    categories: string[];
    series: { name: string; values: (number | null)[] }[];
  }) => Promise<unknown>;
  onClose: () => void;
}) {
  const chart = () => props.shape.chart;
  // rows[0] = header (corner, series names); rows[i] = category, values...
  const initial = (): string[][] => {
    const c = chart();
    if (!c)
      return [
        ['', 'Series 1'],
        ['Category 1', ''],
      ];
    return [
      ['', ...c.series.map((s) => s.name)],
      ...c.categories.map((cat, i) => [
        cat,
        ...c.series.map((s) => {
          const v = s.values[i];
          return v === null || v === undefined ? '' : String(v);
        }),
      ]),
    ];
  };
  const [grid, setGrid] = createSignal(initial());
  const [error, setError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const rows = () => grid().length;
  const cols = () => grid()[0]?.length ?? 0;

  const setCell = (r: number, c: number, value: string) =>
    setGrid((g) =>
      g.map((row, i) =>
        i === r ? row.map((v, j) => (j === c ? value : v)) : row
      )
    );

  const addRow = () =>
    setGrid((g) => [
      ...g,
      [`Category ${g.length}`, ...Array(cols() - 1).fill('')],
    ]);
  const addSeries = () =>
    setGrid((g) =>
      g.map((row, i) => [...row, i === 0 ? `Series ${cols()}` : ''])
    );
  const removeRow = (r: number) =>
    rows() > 2 && setGrid((g) => g.filter((_, i) => i !== r));
  const removeSeries = (c: number) =>
    cols() > 2 && setGrid((g) => g.map((row) => row.filter((_, j) => j !== c)));

  const onPaste = (r: number, c: number, e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text
      .replace(/\r/g, '')
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => l.split('\t'));
    setGrid((g) => {
      const next = g.map((row) => [...row]);
      const width = Math.max(
        cols(),
        c + Math.max(...lines.map((l) => l.length))
      );
      while (next.length < r + lines.length) next.push(Array(width).fill(''));
      for (const row of next) while (row.length < width) row.push('');
      lines.forEach((line, i) =>
        line.forEach((v, j) => (next[r + i][c + j] = v))
      );
      return next;
    });
  };

  const apply = async () => {
    const g = grid();
    const categories = g.slice(1).map((row) => row[0]);
    const series: { name: string; values: (number | null)[] }[] = [];
    for (let c = 1; c < cols(); c++) {
      const values: (number | null)[] = [];
      for (let r = 1; r < rows(); r++) {
        const v = parseNumber(g[r][c] ?? '');
        if (v === undefined) {
          setError(
            `"${g[r][c]}" in ${g[0][c] || `column ${c + 1}`} is not a number.`
          );
          return;
        }
        values.push(v);
      }
      series.push({ name: g[0][c] || `Series ${c}`, values });
    }
    setError(undefined);
    setBusy(true);
    try {
      await props.onApply({ categories, series });
      props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[min(720px,92vw)]"
    >
      <div class="flex flex-col gap-3 p-4" data-testid="pptx-chart-data">
        <div class="flex items-center justify-between">
          <h2 class="flex items-center gap-2 font-semibold text-ink text-sm">
            <TableIcon class="size-4" />
            Edit chart data
          </h2>
          <Button
            size="icon-sm"
            variant="ghost"
            label="Close"
            onClick={props.onClose}
          >
            <X />
          </Button>
        </div>
        <Show when={chart() && !chart()!.editable}>
          <p class="rounded-md bg-ink/5 p-2 text-ink-muted text-xs">
            This chart's data can't be changed here (combination charts and
            scatter, bubble, stock, surface, and radar charts are not supported
            yet).
          </p>
        </Show>
        <div class="max-h-[55vh] overflow-auto rounded-md border border-edge-muted">
          <table class="w-full border-collapse text-xs">
            <tbody>
              <Index each={grid()}>
                {(row, r) => (
                  <tr class="group">
                    <Index each={row()}>
                      {(value, c) => (
                        <td
                          class="border border-edge-muted p-0"
                          classList={{
                            'bg-ink/5 font-medium': r === 0 || c === 0,
                            'min-w-28': c === 0,
                            'min-w-20': c > 0,
                          }}
                        >
                          <Show
                            when={!(r === 0 && c === 0)}
                            fallback={
                              <span class="block h-7 px-1.5 leading-7 text-ink-muted" />
                            }
                          >
                            <input
                              class="h-7 w-full min-w-0 border-0 bg-transparent px-1.5 text-xs text-ink outline-none focus:bg-accent-bg"
                              classList={{
                                'text-right tabular-nums': r > 0 && c > 0,
                              }}
                              aria-label={
                                r === 0
                                  ? `Series ${c} name`
                                  : c === 0
                                    ? `Category ${r}`
                                    : `${grid()[0][c] || `Series ${c}`}, ${grid()[r][0] || `row ${r}`}`
                              }
                              data-testid={`pptx-chart-cell-${r}-${c}`}
                              value={value()}
                              disabled={props.readonly}
                              onInput={(e) =>
                                setCell(r, c, e.currentTarget.value)
                              }
                              onPaste={(e) => onPaste(r, c, e)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                const move = (dr: number, dc: number) => {
                                  e.preventDefault();
                                  const el =
                                    document.querySelector<HTMLInputElement>(
                                      `[data-testid="pptx-chart-cell-${r + dr}-${c + dc}"]`
                                    );
                                  el?.focus();
                                  el?.select();
                                };
                                if (e.key === 'Enter')
                                  move(e.shiftKey ? -1 : 1, 0);
                                else if (e.key === 'ArrowDown') move(1, 0);
                                else if (e.key === 'ArrowUp') move(-1, 0);
                              }}
                            />
                          </Show>
                        </td>
                      )}
                    </Index>
                    <td class="w-7 border-0 p-0">
                      <Show when={r > 0 && rows() > 2 && !props.readonly}>
                        <button
                          type="button"
                          class="invisible flex size-7 items-center justify-center text-ink-muted hover:text-failure group-hover:visible"
                          aria-label={`Remove ${grid()[r][0] || `row ${r}`}`}
                          onClick={() => removeRow(r)}
                        >
                          <Trash class="size-3.5" />
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </Index>
              <tr>
                <td class="border-0 p-0" />
                <Index each={grid()[0]?.slice(1) ?? []}>
                  {(_, i) => (
                    <td class="border-0 p-0 text-center">
                      <Show when={cols() > 2 && !props.readonly}>
                        <button
                          type="button"
                          class="text-ink-muted text-xs hover:text-failure"
                          aria-label={`Remove ${grid()[0][i + 1] || 'series'}`}
                          onClick={() => removeSeries(i + 1)}
                        >
                          Remove
                        </button>
                      </Show>
                    </td>
                  )}
                </Index>
              </tr>
            </tbody>
          </table>
        </div>
        <Show when={error()}>
          <p class="text-failure text-xs">{error()}</p>
        </Show>
        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={props.readonly}
            onClick={addRow}
          >
            <Plus />
            Category
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={props.readonly}
            onClick={addSeries}
          >
            <Plus />
            Series
          </Button>
          <span class="flex-1 text-ink-muted text-xs">
            Tip: paste cells from a spreadsheet.
          </span>
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="cta"
            data-testid="pptx-chart-apply"
            disabled={
              props.readonly || busy() || (chart() ? !chart()!.editable : false)
            }
            onClick={() => void apply()}
          >
            Apply
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const LEGEND_POSITIONS: [LegendPosition | 'none', string][] = [
  ['none', 'None'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['left', 'Left'],
  ['bottom', 'Bottom'],
];

/** The contextual Chart Design tab for the selected chart. */
export function ChartDesignTab(props: {
  shape: ShapeOutline;
  onEditData: () => void;
}) {
  const env = useRibbon();
  const c = env.commands;
  const chart = () => props.shape.chart;
  const ro = () => env.readonly();
  const accents = () =>
    (env.deck()?.themeColors ?? []).filter(([slot]) =>
      slot.startsWith('accent')
    );
  const palettes = () => {
    const base = accents();
    const colorful = base.map(([slot]) => slot);
    const mono = base.map(([slot, css]) => ({
      label: `Monochromatic ${slot.replace('accent', 'accent ')}`,
      colors: [1, 0.75, 0.5, 0.4, 0.6, 0.8].map((m, i) =>
        i < 3
          ? modulate(css.replace('#', ''), m)
          : modulate(css.replace('#', ''), m, 1 - m)
      ),
    }));
    return [{ label: 'Colorful', colors: colorful }, ...mono];
  };
  return (
    <>
      <RibbonGroup label="Chart layouts">
        <RibbonPopover
          label="Chart title"
          text="Title"
          icon={<span class="sr-only">Title</span>}
          disabled={ro()}
        >
          {(close) => (
            <div class="flex w-56 flex-col gap-1">
              <PopoverItem
                label="None"
                onClick={() => {
                  close();
                  void c.formatChart({ title: '' });
                }}
              />
              <form
                class="flex gap-1 p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get('title');
                  close();
                  void c.formatChart({ title: String(value ?? '') });
                }}
              >
                <input
                  name="title"
                  aria-label="Chart title"
                  value={chart()?.title ?? 'Chart title'}
                  class="h-7 min-w-0 flex-1 rounded-md border border-edge-muted bg-input px-2 text-xs"
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <Button size="xs" variant="outline" type="submit">
                  Set
                </Button>
              </form>
            </div>
          )}
        </RibbonPopover>
        <RibbonPopover
          label="Legend"
          text="Legend"
          icon={<span class="sr-only">Legend</span>}
          disabled={ro()}
        >
          {(close) => (
            <div class="flex w-36 flex-col">
              <For each={LEGEND_POSITIONS}>
                {([pos, label]) => (
                  <PopoverItem
                    label={label}
                    active={(chart()?.legend ?? 'none') === pos}
                    onClick={() => {
                      close();
                      void c.formatChart({ legend: pos });
                    }}
                  />
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
        <RibbonTextButton
          label="Data labels"
          variant={chart()?.dataLabels ? 'accent' : 'ghost'}
          aria-pressed={!!chart()?.dataLabels}
          disabled={ro()}
          onClick={() =>
            void c.formatChart({ dataLabels: !chart()?.dataLabels })
          }
        >
          Data labels
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Chart styles">
        <RibbonPopover
          label="Change colors"
          text="Colors"
          icon={
            <span class="flex gap-px">
              <For each={accents().slice(0, 3)}>
                {([, css]) => (
                  <span
                    class="h-3 w-1 rounded-sm"
                    style={{ background: css }}
                  />
                )}
              </For>
            </span>
          }
          disabled={ro()}
        >
          {(close) => (
            <div class="flex w-60 flex-col">
              <For each={palettes()}>
                {(p) => (
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-ink/5"
                    onClick={() => {
                      close();
                      const n = chart()?.series.length ?? 0;
                      void c.formatChart({
                        seriesColors: Array.from({ length: n }, (_, i) => ({
                          series: i,
                          color: p.colors[i % p.colors.length],
                        })),
                      });
                    }}
                  >
                    <span class="flex gap-px">
                      <For each={p.colors}>
                        {(color) => {
                          const css = color.startsWith('accent')
                            ? accents().find(([s]) => s === color)?.[1]
                            : `#${color}`;
                          return (
                            <span
                              class="size-3 rounded-sm"
                              style={{ background: css }}
                            />
                          );
                        }}
                      </For>
                    </span>
                    {p.label}
                  </button>
                )}
              </For>
            </div>
          )}
        </RibbonPopover>
      </RibbonGroup>
      <RibbonGroup label="Data">
        <RibbonTextButton
          label="Edit data"
          disabled={ro()}
          data-testid="pptx-chart-edit-data"
          onClick={props.onEditData}
        >
          <TableIcon />
          Edit data
        </RibbonTextButton>
      </RibbonGroup>
      <RibbonGroup label="Type">
        <RibbonPopover
          label="Change chart type"
          text="Change chart type"
          icon={<span class="sr-only">Change chart type</span>}
          disabled={ro() || !chart()?.editable}
          testId="pptx-chart-type"
        >
          {(close) => (
            <ChartGallery
              current={chart()}
              onPick={(choice) => {
                close();
                void c.setChartType(choice.kind, choice.grouping);
              }}
            />
          )}
        </RibbonPopover>
      </RibbonGroup>
    </>
  );
}
