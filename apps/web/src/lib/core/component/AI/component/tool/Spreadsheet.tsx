import SpreadsheetIcon from '@icon/wide-spreadsheet.svg';
import type { SpreadsheetResponse } from '@service-cognition/generated/tools/types';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function SpreadsheetResult(props: { result: SpreadsheetResponse }) {
  const read = () =>
    props.result.action === 'read' ? props.result : undefined;
  const calculation = () =>
    props.result.action === 'calculate' ? props.result : undefined;
  const edit = () =>
    props.result.action === 'edit' ? props.result : undefined;
  return (
    <div class="max-h-80 overflow-auto pb-1 text-xs text-ink">
      <Switch>
        <Match when={read()}>
          {(data) => (
            <>
              <div class="mb-3 flex flex-wrap gap-2 text-ink-muted">
                <For each={data().sheets}>
                  {(sheet) => (
                    <span>
                      {sheet.name} · {sheet.usedRange ?? 'Empty sheet'}
                    </span>
                  )}
                </For>
              </div>
              <For each={data().ranges}>
                {(range) => (
                  <div class="mb-3">
                    <div class="mb-1 font-medium">
                      {range.sheetName} · {range.range}
                    </div>
                    <table class="w-full border-collapse text-left">
                      <thead>
                        <tr class="border-b border-edge-muted text-ink-muted">
                          <th class="p-1 font-normal">Cell</th>
                          <th class="p-1 font-normal">Input</th>
                          <th class="p-1 font-normal">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={range.cells}>
                          {(cell) => (
                            <tr class="border-b border-edge-muted">
                              <td class="p-1 align-top font-mono">
                                {cell.address}
                              </td>
                              <td class="max-w-64 break-all p-1 align-top font-mono">
                                {cell.source}
                              </td>
                              <td
                                class="max-w-64 break-words p-1 align-top"
                                title={cell.error ?? undefined}
                              >
                                {cell.display}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                    <Show when={range.truncated}>
                      <p class="mt-1 text-ink-muted">
                        Showing part of this range.
                      </p>
                    </Show>
                  </div>
                )}
              </For>
            </>
          )}
        </Match>
        <Match when={calculation()}>
          {(data) => (
            <>
              <p class="mb-2 text-ink-muted">
                Scratch calculation · workbook unchanged
              </p>
              <For each={data().results}>
                {(result) => (
                  <div class="mb-2">
                    <Show when={result.label}>
                      <div class="font-medium">{result.label}</div>
                    </Show>
                    <div class="break-all font-mono">{result.formula}</div>
                    <div class="mt-0.5" title={result.error ?? undefined}>
                      {result.display || '(empty)'}
                    </div>
                    <Show when={result.error}>
                      <p class="text-failure">{result.error}</p>
                    </Show>
                  </div>
                )}
              </For>
            </>
          )}
        </Match>
        <Match when={edit()}>
          {(data) => (
            <>
              <p class="mb-2 text-ink-muted">
                {data().applied ? 'Changes saved' : 'No new changes'}
              </p>
              <For each={data().changes}>
                {(change) => (
                  <p class="mb-1">
                    {change.summary}
                    <Show when={change.range}> · {change.range}</Show>
                  </p>
                )}
              </For>
            </>
          )}
        </Match>
      </Switch>
      <For each={props.result.warnings}>
        {(warning) => <p class="mt-2 text-ink-muted">{warning}</p>}
      </For>
    </div>
  );
}

function SpreadsheetToolRow(props: {
  label: string;
  result?: SpreadsheetResponse;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(false);
  const summary = () => {
    const result = props.result;
    if (!result) return '';
    const [count, noun] =
      result.action === 'calculate'
        ? ([result.results.length, 'result'] as const)
        : result.action === 'edit'
          ? ([result.changes.length, 'change'] as const)
          : ([result.sheets.length, 'sheet'] as const);
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  };
  return (
    <BaseTool
      icon={SpreadsheetIcon}
      type="call"
      renderContext={props.renderContext}
      response={
        <Show when={expanded() && props.result}>
          {(result) => <SpreadsheetResult result={result()} />}
        </Show>
      }
    >
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1">{props.label}</span>
        <Show when={props.result}>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            status={<span>{summary()}</span>}
          />
        </Show>
      </div>
    </BaseTool>
  );
}

export const readSpreadsheetHandler = createToolRenderer({
  name: 'ReadSpreadsheet',
  render: (ctx) => (
    <SpreadsheetToolRow
      label="Read spreadsheet"
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
export const calculateSpreadsheetHandler = createToolRenderer({
  name: 'CalculateSpreadsheet',
  render: (ctx) => (
    <SpreadsheetToolRow
      label="Calculate spreadsheet"
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
export const editSpreadsheetHandler = createToolRenderer({
  name: 'EditSpreadsheet',
  render: (ctx) => (
    <SpreadsheetToolRow
      label="Edit spreadsheet"
      result={ctx.response?.data}
      renderContext={ctx.renderContext}
    />
  ),
});
