import { OptionPill } from '@app/features/block-database/components/select-pill';
import { For, Match, Switch } from 'solid-js';
import type { AnswerRenderers } from '../context/answer-display';
import {
  type ReferenceNames,
  type ResultCell,
  resultCellText,
} from '../core/answer-cell';

/** One result value, drawn with the same pieces as the database grid's cells. */
export function ResultValue(props: {
  cell: ResultCell;
  names: ReferenceNames;
  display: AnswerRenderers;
}) {
  return (
    <Switch fallback={resultCellText(props.cell, props.names)}>
      <Match when={props.cell.kind === 'empty'}>
        <span class="opacity-40">—</span>
      </Match>
      <Match when={props.cell.kind === 'markdown' && props.cell}>
        {(cell) => <>{props.display.text(cell().markdown)}</>}
      </Match>
      <Match when={props.cell.kind === 'boolean' && props.cell}>
        {(cell) => (
          <input
            type="checkbox"
            checked={cell().checked}
            disabled
            aria-label={cell().checked ? 'True' : 'False'}
            class="size-3.5 rounded border-edge-muted align-middle accent-ink disabled:opacity-50"
          />
        )}
      </Match>
      <Match when={props.cell.kind === 'options' && props.cell}>
        {(cell) => (
          <span class="inline-flex min-w-0 max-w-full flex-wrap gap-1 align-middle">
            <For each={cell().options}>
              {(option) => (
                <OptionPill
                  label={option.label}
                  color={option.color}
                  tag={cell().tag}
                />
              )}
            </For>
          </span>
        )}
      </Match>
      <Match when={props.cell.kind === 'row' && props.cell}>
        {(cell) =>
          props.display.row({
            id: cell().id,
            table: cell().table,
            label: resultCellText(cell(), props.names),
          })
        }
      </Match>
      <Match when={props.cell.kind === 'mentions' && props.cell}>
        {(cell) => (
          <span class="inline-flex min-w-0 max-w-full flex-wrap gap-x-2 gap-y-1 align-middle">
            <For each={cell().ids}>
              {(id) => props.display.mention(id, cell().entityType)}
            </For>
          </span>
        )}
      </Match>
    </Switch>
  );
}
