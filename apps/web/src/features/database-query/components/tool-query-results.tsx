import { Select } from '@ui/components/Select';
import { createMemo, createSignal } from 'solid-js';
import { isScalarAnswer, type QueryAnswer } from '../core/query';
import { prepareQueryChart, type QueryDisplayMode } from '../core/query-chart';
import { QueryResults } from './query-results';

/** A shared result surface for native chat and MCP database tools. */
export function ToolQueryResults(props: {
  answer: QueryAnswer;
  sql: string;
  preferredDisplay?: QueryDisplayMode;
}) {
  const [chosenDisplay, setDisplay] = createSignal<QueryDisplayMode>();
  const rowCount = () =>
    props.answer.results.reduce(
      (total, result) => total + result.rows.length,
      0
    );
  const modes = createMemo(() => [
    ...(isScalarAnswer(props.answer)
      ? [{ value: 'scalar' as const, label: 'Answer' }]
      : []),
    { value: 'table' as const, label: 'Table' },
    ...(['bar', 'line', 'pie'] as const)
      .filter((mode) => prepareQueryChart(props.answer, mode).data)
      .map((value) => ({
        value,
        label: `${value[0].toUpperCase()}${value.slice(1)} chart`,
      })),
  ]);
  const display = () =>
    modes().find(
      (mode) => mode.value === (chosenDisplay() ?? props.preferredDisplay)
    ) ?? modes()[0];
  return (
    <div class="min-w-0 space-y-3 p-3">
      <div class="flex items-center justify-between gap-3">
        <Select<{ value: QueryDisplayMode; label: string }>
          options={modes()}
          optionValue="value"
          optionTextValue="label"
          value={display()}
          onChange={(option) => option && setDisplay(option.value)}
        >
          <Select.Trigger
            aria-label="Display database results"
            class="h-7 rounded px-2 text-xs text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <Select.Value<{ value: QueryDisplayMode; label: string }>>
              {(state) => state.selectedOption().label}
            </Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content portalScope="local">
            <Select.Listbox />
          </Select.Content>
        </Select>
        <span class="text-xs text-ink-muted">
          {rowCount()} {rowCount() === 1 ? 'row' : 'rows'}
        </span>
      </div>
      <QueryResults
        answer={props.answer}
        displayMode={display().value}
        compact
      />
      <details class="text-xs text-ink-muted">
        <summary>View SQL</summary>
        <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-hover p-2">
          {props.sql}
        </pre>
      </details>
    </div>
  );
}
