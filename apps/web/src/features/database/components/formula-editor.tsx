import type { Formula } from '@core/database-sql/generated/types';
import FunctionIcon from '@phosphor/function.svg';
import { Button } from '@ui/components/Button';
import { inputClasses } from '@ui/components/Input';
import {
  createSignal,
  createUniqueId,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  columnSchemaMessage,
  type DatabaseSchemaChange,
} from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import {
  type FormulaTools,
  formulaInputs,
  loadFormulaTools,
} from '../core/formula';
import { PropertyIcon } from './property-icon';

const operators = [
  { label: '+', text: '+', name: 'Add' },
  { label: '−', text: '-', name: 'Subtract' },
  { label: '×', text: '*', name: 'Multiply' },
  { label: '÷', text: '/', name: 'Divide' },
  { label: '(', text: '(', name: 'Open parenthesis' },
  { label: ')', text: ')', name: 'Close parenthesis' },
];

/**
 * Writes a derived column's formula: typed or built from the column and
 * operator buttons, checked by the engine as it is typed.
 */
export function FormulaEditor(props: {
  tableId: string;
  columns: readonly DatabaseViewColumn[];
  /** The derived column being edited; a new one has none. */
  own?: string;
  /** Asked for when the column is new. */
  name?: string;
  formula?: Formula;
  onSave: (change: { name: string; formula: Formula }) => DatabaseSchemaChange;
  onCancel: () => void;
}) {
  const [tools, setTools] = createSignal<FormulaTools>();
  const [loadError, setLoadError] = createSignal(false);
  const [name, setName] = createSignal(props.name ?? '');
  const [text, setText] = createSignal('');
  const [initial, setInitial] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [saveError, setSaveError] = createSignal('');
  const statusId = createUniqueId();
  let input!: HTMLInputElement;

  onMount(async () => {
    let loaded: FormulaTools;
    try {
      loaded = await loadFormulaTools(props.tableId, props.columns);
    } catch {
      setLoadError(true);
      return;
    }
    setTools(() => loaded);
    if (props.formula) {
      const rendered = loaded.render(props.formula);
      setText(rendered);
      setInitial(rendered);
    }
    // Enabled now; the name comes first for a new column.
    queueMicrotask(() => {
      if (!naming()) input.focus();
    });
  });

  const reading = () => {
    const loaded = tools();
    if (!loaded || !text().trim()) return undefined;
    return loaded.read(text(), props.own);
  };
  const valid = () => {
    const read = reading();
    return read?.status === 'valid' ? read : undefined;
  };
  const invalid = () => {
    const read = reading();
    return read?.status === 'invalid' ? read : undefined;
  };
  const naming = () => props.name !== undefined;
  const canSave = () =>
    !!valid() &&
    !pending() &&
    (!naming() || !!name().trim()) &&
    (naming() || text() !== initial());

  /** Put `insertion` at the caret, spaced from what is around it. */
  function insert(insertion: string) {
    const start = input.selectionStart ?? text().length;
    const end = input.selectionEnd ?? start;
    const before = text().slice(0, start);
    const after = text().slice(end);
    const opening = insertion === '(';
    const closing = insertion === ')';
    const lead = before && !/[\s(]$/.test(before) && !closing ? ' ' : '';
    const trail = after && !/^[\s)]/.test(after) && !opening ? ' ' : '';
    const inserted = `${lead}${insertion}${trail}`;
    setText(before + inserted + after);
    const caret = before.length + inserted.length;
    input.focus();
    input.setSelectionRange(caret, caret);
  }

  async function save() {
    const formula = valid()?.formula;
    if (!formula || !canSave()) return;
    setPending(true);
    setSaveError('');
    const saved = await props.onSave({ name: name().trim(), formula });
    setPending(false);
    if (saved.isErr()) setSaveError(columnSchemaMessage(saved.error));
  }

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div class="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 text-xs text-ink">
      <div class="flex items-center gap-2 font-medium">
        <FunctionIcon class="size-4 text-ink-muted" />
        {props.own ? 'Edit formula' : 'New formula column'}
      </div>
      <Show when={naming()}>
        <label class="flex flex-col gap-1">
          <span class="text-ink-muted">Name</span>
          <input
            class={inputClasses({ size: 'sm' })}
            value={name()}
            maxlength={200}
            aria-label="Column name"
            ref={(element) => queueMicrotask(() => element.select())}
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </label>
      </Show>
      <label class="flex flex-col gap-1">
        <span class="text-ink-muted">Formula</span>
        <input
          ref={input}
          class={inputClasses({ size: 'md', class: 'font-mono text-sm' })}
          value={text()}
          placeholder="Price * Quantity"
          spellcheck={false}
          autocomplete="off"
          aria-label="Formula"
          aria-invalid={!!invalid()}
          aria-describedby={statusId}
          disabled={!tools()}
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <p id={statusId} class="min-h-4" aria-live="polite">
          <Switch
            fallback={
              <span class="text-ink-placeholder">
                {loadError()
                  ? 'Formulas could not load. Try again.'
                  : 'Combine columns and numbers with + − × ÷.'}
              </span>
            }
          >
            <Match when={valid()}>
              {(read) => (
                <span class="text-ink-muted">
                  Gives a{' '}
                  <span class="font-medium text-ink">{read().result}</span>
                </span>
              )}
            </Match>
            <Match when={invalid()}>
              {(read) => <span class="text-failure-ink">{read().message}</span>}
            </Match>
          </Switch>
        </p>
      </label>
      <div class="flex flex-col gap-1.5">
        <span class="text-ink-muted">Columns</span>
        <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          <For
            each={formulaInputs(props.columns, props.own)}
            fallback={
              <span class="text-ink-placeholder">
                Add a number or date column to use it here.
              </span>
            }
          >
            {(column) => (
              <Button
                variant="outline"
                size="xs"
                disabled={!tools()}
                onClick={() => {
                  const loaded = tools();
                  if (loaded)
                    insert(
                      loaded.render({ kind: 'column', column: column.id })
                    );
                }}
              >
                <PropertyIcon
                  type={column.dataType}
                  formula={!!column.formula}
                  class="size-3 shrink-0 text-ink-muted"
                />
                <span class="max-w-40 truncate">{column.name}</span>
              </Button>
            )}
          </For>
        </div>
        <div class="flex gap-1">
          <For each={operators}>
            {(operator) => (
              <Button
                variant="outline"
                size="xs"
                class="min-w-6 justify-center font-mono"
                aria-label={operator.name}
                disabled={!tools()}
                onClick={() => insert(operator.text)}
              >
                {operator.label}
              </Button>
            )}
          </For>
        </div>
        <p class="text-ink-placeholder">
          Add days to a date with <code class="font-mono">Due + 7</code>; count
          the days between dates with <code class="font-mono">Due - Start</code>
          .
        </p>
      </div>
      <Show when={saveError()}>
        <p role="alert" class="text-failure-ink">
          {saveError()}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button
          variant="cta"
          size="sm"
          disabled={!canSave()}
          onClick={() => void save()}
        >
          {pending() ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
