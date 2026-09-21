import { createMemo, For, Show } from 'solid-js';
import {
  formatQueryValue,
  isScalarAnswer,
  type QueryAnswer,
  type QueryResult,
} from '../core/query';
import {
  isChartMode,
  prepareQueryChart,
  type QueryChartConfig,
  type QueryDisplayMode,
} from '../core/query-chart';
import { QueryChart } from './query-chart';

export function QueryResults(props: {
  answer: QueryAnswer;
  compact?: boolean;
  displayMode?: QueryDisplayMode;
  chart?: QueryChartConfig;
}) {
  const chart = createMemo(() =>
    isChartMode(props.displayMode)
      ? prepareQueryChart(props.answer, props.displayMode, props.chart)
      : undefined
  );
  return (
    <div class="min-w-0" aria-label="Question results">
      <Show when={props.answer.truncated_tables.length > 0}>
        <p class="mb-3 rounded-md border border-edge-muted bg-hover px-3 py-2 text-xs text-ink-muted">
          Partial answer: {props.answer.truncated_tables.join(', ')} exceeded
          the data limit. Totals may be incomplete.
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
              !isChartMode(props.displayMode) &&
              props.displayMode !== 'table' &&
              isScalarAnswer(props.answer)
            }
            fallback={<QueryResultTables results={props.answer.results} />}
          >
            <div class="rounded-lg border border-edge-muted bg-hover/40 px-4 py-4">
              <div
                class="text-3xl font-medium tracking-tight tabular-nums text-ink"
                classList={{ 'text-xl': props.compact }}
              >
                {formatQueryValue(props.answer.results[0]?.rows[0]?.[0])}
              </div>
              <div class="mt-1 text-xs text-ink-muted">
                {props.answer.results[0]?.columns[0]?.name.replaceAll('_', ' ')}
              </div>
            </div>
          </Show>
        }
      >
        {(data) => (
          <>
            <QueryChart
              data={data()}
              mode={isChartMode(props.displayMode) ? props.displayMode : 'bar'}
            />
            <details class="mt-3 text-xs text-ink-muted">
              <summary class="rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/25">
                View data
              </summary>
              <div class="mt-2">
                <QueryResultTables results={props.answer.results} />
              </div>
            </details>
          </>
        )}
      </Show>
    </div>
  );
}

function QueryResultTables(props: { results: QueryResult[] }) {
  return (
    <For each={props.results}>
      {(result) => (
        <div class="max-h-80 overflow-auto rounded-lg border border-edge-muted">
          <table class="w-full border-collapse text-left text-xs">
            <thead class="sticky top-0 bg-hover">
              <tr>
                <For each={result.columns}>
                  {(column) => (
                    <th class="border-b border-edge-muted px-3 py-2.5 font-medium text-ink-muted whitespace-nowrap">
                      {column.name.replaceAll('_', ' ')}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={result.rows.slice(0, 100)}>
                {(row) => (
                  <tr class="hover:bg-hover/50">
                    <For each={row}>
                      {(cell) => (
                        <td
                          class="max-w-64 truncate border-b border-edge-muted/60 px-3 py-2 text-ink"
                          title={cell === null ? 'Empty' : String(cell)}
                        >
                          {formatQueryValue(cell)}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={result.rows.length === 0}>
            <p class="px-3 py-6 text-center text-sm text-ink-muted">
              No matching records. Try a broader question.
            </p>
          </Show>
          <div class="px-3 py-2 text-[11px] text-ink-muted">
            {result.rows.length > 100
              ? `Showing 100 of ${result.rows.length} results`
              : `${result.rows.length} ${result.rows.length === 1 ? 'record' : 'records'}`}
          </div>
        </div>
      )}
    </For>
  );
}
