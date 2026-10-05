import {
  DATABASE_QUERY_CHART_MODES,
  type DatabaseQueryDisplayMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { Select } from '@ui/components/Select';
import { createMemo, createSignal, Show } from 'solid-js';
import { match, P } from 'ts-pattern';
import { QueryResults } from '../components/query-results';
import { useAnswerDisplay } from '../context/answer-display';
import type { QueryAnswer } from '../core/query';
import { availableDisplayModes, chartModeLabel } from '../core/query-chart';

type DisplayOption = { value: DatabaseQueryDisplayMode; label: string };

/** A shared result surface for native chat and MCP database tools. */
export function ToolQueryResults(props: {
  answer: QueryAnswer;
  sql: string;
  preferredDisplay?: DatabaseQueryDisplayMode;
  showSql: boolean;
}) {
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  const [chosenDisplay, setDisplay] = createSignal<DatabaseQueryDisplayMode>();
  const rowCount = () => props.answer.rows.length;
  const modes = createMemo(() =>
    availableDisplayModes(props.answer).map(
      (value): DisplayOption => ({
        value,
        label: match(value)
          .with('scalar', () => 'Answer')
          .with('table', () => 'Table')
          .with(P.union(...DATABASE_QUERY_CHART_MODES), chartModeLabel)
          .exhaustive(),
      })
    )
  );
  const current = () =>
    modes().find(
      (mode) => mode.value === (chosenDisplay() ?? props.preferredDisplay)
    ) ?? modes()[0];
  return (
    <div class="min-w-0 space-y-3 p-3">
      <div class="flex items-center justify-between gap-3">
        <Select<DisplayOption>
          options={modes()}
          optionValue="value"
          optionTextValue="label"
          value={current()}
          onChange={(option) => option && setDisplay(option.value)}
        >
          <Select.Trigger
            aria-label="Display database results"
            class="h-7 rounded px-2 text-xs text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <Select.Value<DisplayOption>>
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
        displayMode={current().value}
        names={names()}
        display={display}
        compact
      />
      <Show when={props.showSql}>
        <details class="text-xs text-ink-muted">
          <summary>View SQL</summary>
          <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-hover p-2">
            {props.sql}
          </pre>
        </details>
      </Show>
    </div>
  );
}
