import { macroThemeExtension } from '@block-code/component/cmTheme';
import { SQLite, sql } from '@codemirror/lang-sql';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { createEffect, onCleanup, onMount } from 'solid-js';
import type { QuerySchema } from '../core/query';

/** CodeMirror owns editing; the host owns query state and execution. */
export function SqlEditor(props: {
  value: string;
  schema: QuerySchema;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onRun: () => void;
}) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  let syncing = false;
  const language = new Compartment();
  const editing = new Compartment();
  const editability = () => [
    EditorState.readOnly.of(Boolean(props.readOnly)),
    EditorView.editable.of(!props.readOnly),
  ];
  const completion = () =>
    sql({
      dialect: SQLite,
      schema: Object.fromEntries(
        props.schema.tables.map((table) => [
          table.sqlName,
          [
            table.primaryKey ?? 'row_id',
            ...table.columns.map((column) => column.sqlName),
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
          editing.of(editability()),
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
  createEffect(() => {
    const value = props.value;
    if (view && value !== view.state.doc.toString()) {
      syncing = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        });
      } finally {
        syncing = false;
      }
    }
  });
  createEffect(() => {
    const extension = completion();
    view?.dispatch({ effects: language.reconfigure(extension) });
  });
  createEffect(() => {
    const extension = editability();
    view?.dispatch({ effects: editing.reconfigure(extension) });
  });
  onCleanup(() => view?.destroy());
  return (
    <div
      ref={container}
      class="max-h-44 overflow-auto rounded-md border border-edge-muted bg-input text-xs [&_.cm-editor]:min-h-20 [&_.cm-focused]:outline-none"
    />
  );
}
