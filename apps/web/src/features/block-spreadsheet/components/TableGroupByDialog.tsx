import CaretDown from '@icon/system/regular/caret-down.svg';
import Check from '@icon/system/regular/check.svg';
import type { CollectionNode } from '@kobalte/core';
import type { TableCellText } from '@macro-inc/spreadsheet/table-filters';
import {
  GROUP_SUMMARIES,
  GROUP_SUMMARY_LABELS,
  type GroupSummary,
  percentSummary,
  summarize,
} from '@macro-inc/spreadsheet/table-groups';
import { Button } from '@ui/components/Button';
import { Select } from '@ui/components/Select';
import { For, Show } from 'solid-js';
import type { TableGroupView } from '../core/table-types';
import { SpreadsheetDialog } from './SpreadsheetDialog';

type Choice = { value: number | GroupSummary; label: string };

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function Picker(props: {
  label: string;
  choices: Choice[];
  value: Choice['value'];
  onChange: (value: Choice['value']) => void;
}) {
  return (
    <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
      {props.label}
      <Select<Choice>
        options={props.choices}
        value={props.choices.find((choice) => choice.value === props.value)}
        onChange={(choice) => {
          if (choice && choice.value !== props.value)
            props.onChange(choice.value);
        }}
        optionValue="value"
        optionTextValue="label"
        itemComponent={(item: { item: CollectionNode<Choice> }) => (
          <Select.Item
            item={item.item}
            class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs outline-none data-highlighted:bg-hover"
          >
            <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
            <Select.ItemIndicator>
              <Check class="size-3" />
            </Select.ItemIndicator>
          </Select.Item>
        )}
      >
        <Select.Trigger
          aria-label={props.label}
          class="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-edge-muted px-2 text-sm font-normal text-ink"
        >
          <Select.Value<Choice>>
            {(state) => (
              <span class="truncate">{state.selectedOption().label}</span>
            )}
          </Select.Value>
          <CaretDown class="size-3 shrink-0 text-ink-muted" />
        </Select.Trigger>
        <Select.Content class="max-h-72" portalScope="local">
          <Select.Listbox />
        </Select.Content>
      </Select>
    </label>
  );
}

/**
 * A table's rows grouped by one column's values, as Google Sheets' group by
 * view shows them, with another column summarized for each group. Choosing a
 * group filters the table to it.
 */
export function TableGroupByDialog(props: {
  view: TableGroupView | undefined;
  /** The table's column names, from its first column. */
  columns: string[];
  /** The sheet column of the table's first column. */
  left: number;
  groups: { value: string; rows: number[]; cells: TableCellText[] }[];
  readonly: boolean;
  /** A sum, average, min or max in the summarized column's format. */
  format: (value: number) => string;
  onChange: (view: Partial<Omit<TableGroupView, 'table'>>) => void;
  onShowGroup: (value: string | undefined) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const columnChoices = () =>
    props.columns.map((label, index) => ({ value: props.left + index, label }));
  const shown = (value: number | undefined, summary: GroupSummary) =>
    value === undefined
      ? '—'
      : percentSummary(summary)
        ? percent.format(value)
        : ['sum', 'average', 'min', 'max'].includes(summary)
          ? props.format(value)
          : number.format(value);
  return (
    <SpreadsheetDialog
      open={!!props.view}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onRestoreFocus={props.onRestoreFocus}
      position="center"
      class="w-[34rem] max-w-[calc(100vw-2rem)]"
    >
      <Show when={props.view}>
        {(view) => {
          const summaryLabel = () =>
            `${GROUP_SUMMARY_LABELS[view().summary]} of ${
              props.columns[view().summaryColumn - props.left] ?? ''
            }`;
          const all = () => props.groups.flatMap((group) => group.cells);
          return (
            <div class="flex flex-col gap-3 p-5 text-sm">
              <SpreadsheetDialog.Title class="font-semibold">
                Group by view · {view().table}
              </SpreadsheetDialog.Title>
              <SpreadsheetDialog.Description class="text-ink-muted">
                Rows grouped by one column, with another summarized for each
                group.
                {props.readonly ? '' : ' Choose a group to show only its rows.'}
              </SpreadsheetDialog.Description>
              <div class="flex flex-wrap gap-2">
                <Picker
                  label="Group by"
                  choices={columnChoices()}
                  value={view().column}
                  onChange={(column) =>
                    typeof column === 'number' && props.onChange({ column })
                  }
                />
                <Picker
                  label="Summarize"
                  choices={columnChoices()}
                  value={view().summaryColumn}
                  onChange={(summaryColumn) =>
                    typeof summaryColumn === 'number' &&
                    props.onChange({ summaryColumn })
                  }
                />
                <Picker
                  label="As"
                  choices={GROUP_SUMMARIES.map((value) => ({
                    value,
                    label: GROUP_SUMMARY_LABELS[value],
                  }))}
                  value={view().summary}
                  onChange={(summary) =>
                    typeof summary === 'string' && props.onChange({ summary })
                  }
                />
              </div>
              <div class="max-h-[50dvh] overflow-auto rounded-md border border-edge-muted">
                <table class="w-full border-collapse text-left text-sm">
                  <thead class="sticky top-0 bg-panel text-xs text-ink-muted">
                    <tr>
                      <th class="px-3 py-2 font-medium">
                        {props.columns[view().column - props.left]}
                      </th>
                      <th class="px-3 py-2 text-right font-medium">Rows</th>
                      <th class="px-3 py-2 text-right font-medium">
                        {summaryLabel()}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={props.groups}>
                      {(group) => (
                        <tr class="border-t border-edge-divider">
                          <td class="max-w-56 truncate px-3 py-1.5">
                            <Show
                              when={!props.readonly}
                              fallback={group.value || '(Blank)'}
                            >
                              <button
                                type="button"
                                title={`Show only rows with ${group.value || 'blanks'}`}
                                class="max-w-full truncate text-left text-accent hover:underline"
                                onClick={() => props.onShowGroup(group.value)}
                              >
                                {group.value || '(Blank)'}
                              </button>
                            </Show>
                          </td>
                          <td class="px-3 py-1.5 text-right tabular-nums">
                            {group.rows.length}
                          </td>
                          <td class="px-3 py-1.5 text-right tabular-nums">
                            {shown(
                              summarize(group.cells, view().summary),
                              view().summary
                            )}
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                  <tfoot class="border-t border-edge-muted font-semibold">
                    <tr>
                      <td class="px-3 py-1.5">Total</td>
                      <td class="px-3 py-1.5 text-right tabular-nums">
                        {all().length}
                      </td>
                      <td class="px-3 py-1.5 text-right tabular-nums">
                        {shown(
                          summarize(all(), view().summary),
                          view().summary
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div class="flex justify-end gap-2">
                <Show when={!props.readonly}>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => props.onShowGroup(undefined)}
                  >
                    Show all rows
                  </Button>
                </Show>
                <Button variant="strong" type="button" onClick={props.onClose}>
                  Close
                </Button>
              </div>
            </div>
          );
        }}
      </Show>
    </SpreadsheetDialog>
  );
}
