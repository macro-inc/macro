import {
  type DatabaseQueryChart,
  type DatabaseQueryDisplayMode,
  isDatabaseQueryChartMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { createMemo, For, Show } from 'solid-js';
import type { AnswerRenderers } from '../context/answer-display';
import {
  type ReferenceNames,
  resultCell,
  resultCellText,
} from '../core/answer-cell';
import { isScalarAnswer, type QueryAnswer } from '../core/query';
import { prepareQueryChart } from '../core/query-chart';
import { ResultValue } from './answer-value';
import { QueryChart } from './query-chart';

export function QueryResults(props: {
  answer: QueryAnswer;
  compact?: boolean;
  /** An enclosing viewport owns scrolling and height. */
  unbounded?: boolean;
  displayMode: DatabaseQueryDisplayMode;
  chart?: DatabaseQueryChart;
  /** The names the answer references. */
  names: ReferenceNames;
  display: AnswerRenderers;
}) {
  const chart = createMemo(() =>
    isDatabaseQueryChartMode(props.displayMode)
      ? prepareQueryChart(
          props.answer,
          props.displayMode,
          props.chart,
          props.names
        )
      : undefined
  );
  return (
    <div class="min-w-0" aria-label="Question results">
      <Show when={props.answer.truncatedTables.length > 0}>
        <p class="mb-3 rounded-md border border-edge-muted bg-hover px-3 py-2 text-xs text-ink-muted">
          Partial answer: {props.answer.truncatedTables.join(', ')} exceeded the
          data limit. Totals may be incomplete.
        </p>
      </Show>
      <Show when={chart()?.error}>
        <p class="mb-3 text-xs text-ink-muted" role="status">
          {chart()?.error}
        </p>
      </Show>
      <Show
        when={chart()?.data}
        fallback={
          <Show
            when={
              !isDatabaseQueryChartMode(props.displayMode) &&
              props.displayMode !== 'table' &&
              isScalarAnswer(props.answer)
            }
            fallback={
              <QueryResultTable
                unbounded={props.unbounded}
                answer={props.answer}
                names={props.names}
                display={props.display}
              />
            }
          >
            <div class="rounded-lg border border-edge-muted bg-hover/40 px-4 py-4">
              <div
                class="text-3xl font-medium tracking-tight tabular-nums text-ink"
                classList={{ 'text-xl': props.compact }}
              >
                <ScalarValue
                  answer={props.answer}
                  names={props.names}
                  display={props.display}
                />
              </div>
              <div class="mt-1 text-xs text-ink-muted">
                {props.answer.columns[0]?.name.replaceAll('_', ' ')}
              </div>
            </div>
          </Show>
        }
      >
        {(data) => (
          <>
            <QueryChart data={data()} />
            <details class="mt-3 text-xs text-ink-muted">
              <summary class="rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/25">
                View data
              </summary>
              <div class="mt-2">
                <QueryResultTable
                  unbounded={props.unbounded}
                  answer={props.answer}
                  names={props.names}
                  display={props.display}
                />
              </div>
            </details>
          </>
        )}
      </Show>
    </div>
  );
}

/** The single value of a scalar answer, drawn like the same value in a table. */
export function ScalarValue(props: {
  answer: QueryAnswer;
  names: ReferenceNames;
  display: AnswerRenderers;
}) {
  return (
    <Show when={props.answer.columns[0]} fallback="—">
      {(column) => (
        <ResultValue
          cell={resultCell(props.answer.rows[0]?.[0] ?? null, column())}
          names={props.names}
          display={props.display}
        />
      )}
    </Show>
  );
}

function QueryResultTable(props: {
  answer: QueryAnswer;
  unbounded?: boolean;
  names: ReferenceNames;
  display: AnswerRenderers;
}) {
  const rows = () => props.answer.rows;
  return (
    <div
      class="overflow-auto rounded-lg border border-edge-muted"
      classList={{ 'max-h-80': !props.unbounded }}
    >
      <table class="w-full border-collapse text-left text-xs">
        <thead class="sticky top-0 bg-hover">
          <tr>
            <For each={props.answer.columns}>
              {(column) => (
                <th class="border-b border-edge-muted px-3 py-2.5 font-medium text-ink-muted whitespace-nowrap">
                  {column.name.replaceAll('_', ' ')}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={rows().slice(0, 100)}>
            {(row) => (
              <tr class="hover:bg-hover/50">
                <For each={props.answer.columns}>
                  {(column, index) => {
                    const cell = () => resultCell(row[index()] ?? null, column);
                    return (
                      <td
                        class="max-w-64 truncate border-b border-edge-muted/60 px-3 py-2 text-ink"
                        title={
                          cell().kind === 'empty'
                            ? 'Empty'
                            : resultCellText(cell(), props.names)
                        }
                      >
                        <ResultValue
                          cell={cell()}
                          names={props.names}
                          display={props.display}
                        />
                      </td>
                    );
                  }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={rows().length === 0}>
        <p class="px-3 py-6 text-center text-sm text-ink-muted">
          No matching records. Try a broader question.
        </p>
      </Show>
      <div class="px-3 py-2 text-[11px] text-ink-muted">
        {rows().length > 100
          ? `Showing 100 of ${rows().length} results`
          : `${rows().length} ${rows().length === 1 ? 'record' : 'records'}`}
      </div>
    </div>
  );
}
