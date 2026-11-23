import { t } from '@app/lib/i18n';
import { For, Match, Show, Switch } from 'solid-js';
import { OptionPill } from '../../database/components/select-pill';
import type { AnswerRenderers } from '../context/answer-display';
import {
  namedRows,
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
      <Match when={props.cell.kind === 'link' && props.cell}>
        {(cell) => <>{props.display.link(cell().url)}</>}
      </Match>
      <Match when={props.cell.kind === 'boolean' && props.cell}>
        {(cell) => (
          <input
            type="checkbox"
            checked={cell().checked}
            disabled
            aria-label={
              cell().checked
                ? t('databaseAnswers.true')
                : t('databaseAnswers.false')
            }
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
      <Match when={props.cell.kind === 'rows' && props.cell}>
        {(cell) => (
          <RelatedRows
            ids={cell().ids}
            table={cell().table}
            names={props.names}
            display={props.display}
          />
        )}
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

/** A relation's named rows as links that open them; a count when none is named. */
function RelatedRows(props: {
  ids: string[];
  table: string | null;
  names: ReferenceNames;
  display: AnswerRenderers;
}) {
  const named = () => namedRows(props.ids, props.table, props.names);
  return (
    <Show
      when={named().rows.length > 0}
      fallback={resultCellText(
        { kind: 'rows', ids: props.ids, table: props.table },
        props.names
      )}
    >
      <For each={named().rows}>
        {(row, index) => (
          <>
            {index() > 0 && ', '}
            {props.display.row({ ...row, table: props.table })}
          </>
        )}
      </For>
      {named().more > 0 && ` +${named().more}`}
    </Show>
  );
}
