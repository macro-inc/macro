import { formatLocale, t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { parseISO } from 'date-fns';
import { For, type JSX, Show, untrack } from 'solid-js';
import { formatLength } from '../core/format-length';

export type WeekGridRow = {
  id: string;
  byDay: Readonly<Record<string, number>>;
};

function DayHeader(props: { day: string; today: boolean }): JSX.Element {
  return (
    <th
      scope="col"
      class="w-20 px-2 py-2 text-right text-xs font-medium"
      classList={{
        'text-ink-muted': !props.today,
        'text-ink': props.today,
      }}
    >
      {new Intl.DateTimeFormat(formatLocale(), {
        weekday: 'short',
        day: 'numeric',
      }).format(parseISO(props.day))}
    </th>
  );
}

/** A length in a grid cell, or a dash for none. */
export function GridLength(props: {
  minutes: number | undefined;
}): JSX.Element {
  return (
    <span
      class="tabular-nums"
      classList={{ 'text-ink-extra-muted': !props.minutes }}
    >
      {props.minutes ? formatLength(props.minutes) : '–'}
    </span>
  );
}

function sum(values: readonly (number | undefined)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * A week as a table: rows down, the shown days across, each row's total on
 * the right and each day's at the bottom. Totals count the shown days only.
 * Rows keep their cells across new data, so an open cell stays open.
 */
export function WeekGrid(props: {
  label: string;
  rowHeader: string;
  days: readonly string[];
  today: string;
  rows: readonly WeekGridRow[];
  /** Who or what a row is for: a task name or a person. */
  rowLabel: (id: string) => JSX.Element;
  /** A row's cell for a day, made once per row and day; read-only when absent. */
  cell?: (
    id: string,
    day: string,
    minutes: () => number | undefined
  ) => JSX.Element;
  /** Content of a row under the last one, such as an add action. */
  footer?: JSX.Element;
}): JSX.Element {
  const dayTotal = (day: string) =>
    sum(props.rows.map((row) => row.byDay[day]));
  return (
    <table
      aria-label={props.label}
      class="w-full table-fixed border-collapse text-sm"
    >
      <thead>
        <tr class="border-b border-edge-muted">
          <th
            scope="col"
            class="px-2 py-2 text-left text-xs font-medium text-ink-muted"
          >
            {props.rowHeader}
          </th>
          <For each={props.days}>
            {(day) => <DayHeader day={day} today={day === props.today} />}
          </For>
          <th
            scope="col"
            class="w-24 px-2 py-2 text-right text-xs font-medium text-ink-muted"
          >
            {t('timeTracking.totalColumn')}
          </th>
        </tr>
      </thead>
      <tbody>
        <Key each={props.rows} by="id">
          {(row) => {
            const id = untrack(() => row().id);
            return (
              <tr class="border-b border-edge-muted/60">
                <th scope="row" class="min-w-0 px-2 py-1 text-left font-normal">
                  {untrack(() => props.rowLabel(id))}
                </th>
                <For each={props.days}>
                  {(day) => (
                    <td class="px-1 py-1 text-right">
                      <Show
                        when={props.cell}
                        fallback={<GridLength minutes={row().byDay[day]} />}
                      >
                        {(cell) =>
                          untrack(() => cell()(id, day, () => row().byDay[day]))
                        }
                      </Show>
                    </td>
                  )}
                </For>
                <td class="px-2 py-1 text-right font-medium">
                  <GridLength
                    minutes={sum(props.days.map((day) => row().byDay[day]))}
                  />
                </td>
              </tr>
            );
          }}
        </Key>
        <Show when={props.footer}>
          <tr>
            <td colSpan={props.days.length + 2} class="px-1 py-1">
              {props.footer}
            </td>
          </tr>
        </Show>
      </tbody>
      <tfoot>
        <tr class="border-t border-edge-muted font-medium">
          <th scope="row" class="px-2 py-2 text-left">
            {t('timeTracking.totalColumn')}
          </th>
          <For each={props.days}>
            {(day) => (
              <td class="px-2 py-2 text-right">
                <GridLength minutes={dayTotal(day)} />
              </td>
            )}
          </For>
          <td class="px-2 py-2 text-right">
            <GridLength minutes={sum(props.days.map(dayTotal))} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
