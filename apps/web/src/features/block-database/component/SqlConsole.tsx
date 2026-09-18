import { macroThemeExtension } from '@block-code/component/cmTheme';
import { SQLite, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import PlayIcon from '@phosphor/play.svg';
import XIcon from '@phosphor/x.svg';
import { execSql, invalidateDatabase } from '@queries/storage/databases';
import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { Button } from '@ui';
import { basicSetup } from 'codemirror';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';

type SqlConsoleProps = {
  detail: DatabaseDetail;
  onClose: () => void;
};

/**
 * The SQL escape hatch. Reads and writes both run through `exec`, so this is
 * the same engine the grid uses — a statement typed here and a cell edited in
 * the grid are the same kind of write.
 */
export function SqlConsole(props: SqlConsoleProps) {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;

  const [outcome, setOutcome] = createSignal<ExecOutcome>();
  const [error, setError] = createSignal<string>();
  const [running, setRunning] = createSignal(false);

  /** Table and column SQL names, for lang-sql's completions. */
  const completionSchema = () =>
    Object.fromEntries(
      props.detail.tables.map((table) => [
        table.sql_name,
        ['row_id', ...table.columns.map((column) => column.sql_name)],
      ])
    );

  const run = async () => {
    if (!view || running()) return;
    const statement = view.state.doc.toString().trim();
    if (!statement) return;

    setRunning(true);
    setError(undefined);
    try {
      const result = await execSql({ sql: statement });
      setOutcome(result);
      if (result.changes_applied > 0) {
        await invalidateDatabase(props.detail.database.id);
      }
    } catch (caught) {
      setOutcome(undefined);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  onMount(() => {
    view = new EditorView({
      parent: containerRef,
      state: EditorState.create({
        doc: `SELECT * FROM ${props.detail.tables[0]?.sql_name ?? ''}`,
        extensions: [
          basicSetup,
          sql({ dialect: SQLite, schema: completionSchema() }),
          keymap.of([
            {
              key: 'Mod-Enter',
              preventDefault: true,
              run: () => {
                void run();
                return true;
              },
            },
          ]),
          macroThemeExtension,
        ],
      }),
    });
  });

  onCleanup(() => view?.destroy());

  return (
    <div class="flex max-h-[45%] min-h-0 shrink-0 flex-col border-edge border-t">
      <div class="flex shrink-0 items-center justify-between gap-2 px-2 py-1">
        <span class="text-ink-muted text-xs">SQL</span>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={run}
            disabled={running()}
            title="Run (Cmd/Ctrl+Enter)"
          >
            <PlayIcon class="size-3" />
            Run
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            <XIcon class="size-3" />
          </Button>
        </div>
      </div>

      <div class="max-h-40 shrink-0 overflow-auto" ref={containerRef} />

      <div class="min-h-0 flex-1 overflow-auto border-edge border-t">
        <Show when={error()}>
          {(message) => (
            <pre class="whitespace-pre-wrap p-2 text-failure-ink text-xs">
              {message()}
            </pre>
          )}
        </Show>
        <Show when={outcome()}>
          {(result) => (
            <div class="p-2 text-xs">
              <Show when={result().changes_applied > 0}>
                <div class="pb-2 text-ink-muted">
                  {result().changes_applied} row change
                  {result().changes_applied === 1 ? '' : 's'} applied.
                </div>
              </Show>
              <Show when={result().truncated_tables.length > 0}>
                <div class="pb-2 text-ink-muted">
                  Partial data: {result().truncated_tables.join(', ')} hit the
                  row cap, so aggregates over them are incomplete.
                </div>
              </Show>
              <For each={result().results}>
                {(resultSet) => (
                  <div class="overflow-auto pb-3">
                    <table class="w-max border-collapse text-left">
                      <thead>
                        <tr>
                          <For each={resultSet.columns}>
                            {(column) => (
                              <th class="border-edge border-b px-2 py-1 font-medium text-ink-muted">
                                {column.name}
                              </th>
                            )}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={resultSet.rows}>
                          {(row) => (
                            <tr>
                              <For each={row}>
                                {(cell) => (
                                  <td class="border-edge/60 border-b px-2 py-1 text-ink">
                                    {cell === null ? '' : String(cell)}
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                    <Show when={resultSet.rows.length === 0}>
                      <div class="px-2 py-1 text-ink-extra-muted">No rows.</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
