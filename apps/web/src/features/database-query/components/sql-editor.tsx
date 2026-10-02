import { macroThemeExtension } from '@block-code/component/cmTheme';
import { SQLDialect, sql } from '@codemirror/lang-sql';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { type QuerySchema, unquoteIdentifier } from '../core/query';

/** The Macro Databases subset (`crates/database_sql`): its keywords and nothing more. */
const macroDialect = SQLDialect.define({
  keywords:
    'select distinct from join on where and or not in has is null like group by order asc desc limit offset true false count sum avg min max',
  identifierQuotes: '"',
});

/** CodeMirror owns editing; the host owns query state and execution. */
export function SqlEditor(props: {
  value: string;
  schema: QuerySchema;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  let syncing = false;
  const language = new Compartment();
  const completion = () =>
    sql({
      dialect: macroDialect,
      schema: Object.fromEntries(
        props.schema.tables.map((table) => [
          unquoteIdentifier(table.sqlName),
          [
            table.primaryKey ?? 'row_id',
            ...table.columns.map((column) => unquoteIdentifier(column.sqlName)),
          ],
        ])
      ),
    });

  onMount(() => {
    view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          language.of(completion()),
          macroThemeExtension,
          EditorView.contentAttributes.of({
            'aria-label': 'Query SQL',
            spellcheck: 'false',
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing)
              props.onChange(update.state.doc.toString());
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                preventDefault: true,
                run: () => {
                  props.onRun();
                  return true;
                },
              },
            ])
          ),
        ],
      }),
    });
  });
  createEffect(
    on(
      () => props.value,
      (value) => {
        if (!view || value === view.state.doc.toString()) return;
        syncing = true;
        try {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
          });
        } finally {
          syncing = false;
        }
      }
    )
  );
  createEffect(
    on(completion, (extension) => {
      view?.dispatch({ effects: language.reconfigure(extension) });
    })
  );
  onCleanup(() => view?.destroy());
  return (
    <div
      ref={container}
      class="max-h-44 overflow-auto rounded-md border border-edge-muted bg-input text-xs [&_.cm-editor]:min-h-20 [&_.cm-focused]:outline-none"
    />
  );
}
