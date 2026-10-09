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
  formulaCompletion,
  formulaInputs,
  loadFormulaTools,
} from '../core/formula';
import { PropertyIcon } from './property-icon';

/**
 * Writes a derived column's formula, suggesting columns as their names are
 * typed and checking it with the engine on every change.
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
  const [caret, setCaret] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  /** Escape hides the suggestions until the next edit. */
  const [dismissed, setDismissed] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const statusId = createUniqueId();
  const listId = createUniqueId();
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

  const completion = () =>
    focused() && !dismissed() && tools()
      ? formulaCompletion(
          text(),
          caret(),
          formulaInputs(props.columns, props.own)
        )
      : undefined;
  const activeIndex = () =>
    Math.min(active(), (completion()?.matches.length ?? 1) - 1);
  const optionId = (index: number) => `${listId}-${index}`;

  function edit(value: string, at: number) {
    setText(value);
    setCaret(at);
    setActive(0);
    setDismissed(false);
  }

  /** Replace the partly typed name with `column`, as the formula writes it. */
  function accept(column: DatabaseViewColumn) {
    const loaded = tools();
    const open = completion();
    if (!loaded || !open) return;
    const reference = loaded.render({ kind: 'column', column: column.id });
    const value =
      text().slice(0, open.start) + reference + text().slice(caret());
    const at = open.start + reference.length;
    edit(value, at);
    queueMicrotask(() => input.setSelectionRange(at, at));
  }

  /** Put `insertion` at the caret, spaced from what is around it. */
  function insert(insertion: string) {
    const start = input.selectionStart ?? text().length;
    const end = input.selectionEnd ?? start;
    const before = text().slice(0, start);
    const after = text().slice(end);
    const lead = before && !/[\s(]$/.test(before) ? ' ' : '';
    const trail = after && !/^[\s)]/.test(after) ? ' ' : '';
    const inserted = `${lead}${insertion}${trail}`;
    const at = before.length + inserted.length;
    edit(before + inserted + after, at);
    input.focus();
    queueMicrotask(() => input.setSelectionRange(at, at));
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

  const onFormulaKeyDown = (event: KeyboardEvent) => {
    const open = completion();
    if (!open || event.isComposing) return onKeyDown(event);
    const count = open.matches.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : count - 1;
      setActive((activeIndex() + step) % count);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      accept(open.matches[activeIndex()]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    } else {
      onKeyDown(event);
    }
  };

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
        <div class="relative">
          <input
            ref={input}
            class={inputClasses({ size: 'md', class: 'font-mono text-sm' })}
            value={text()}
            spellcheck={false}
            autocomplete="off"
            role="combobox"
            aria-label="Formula"
            aria-autocomplete="list"
            aria-expanded={!!completion()}
            aria-controls={listId}
            aria-activedescendant={
              completion() ? optionId(activeIndex()) : undefined
            }
            aria-invalid={!!invalid()}
            aria-describedby={statusId}
            disabled={!tools()}
            onInput={(event) =>
              edit(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? 0
              )
            }
            onKeyUp={(event) =>
              setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onClick={(event) =>
              setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onFormulaKeyDown}
          />
          <Show when={completion()}>
            {(open) => (
              <ul
                id={listId}
                role="listbox"
                aria-label="Columns"
                class="absolute top-full right-0 left-0 z-1 mt-1 max-h-48 overflow-y-auto rounded-lg border border-edge bg-menu p-1 shadow-menu"
              >
                <For each={open().matches}>
                  {(column, index) => (
                    <li
                      id={optionId(index())}
                      role="option"
                      aria-selected={index() === activeIndex()}
                      class="flex h-7 items-center gap-1.5 rounded-md px-2 aria-selected:bg-hover"
                      // Keep focus in the formula while picking.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index())}
                      onClick={() => accept(column)}
                    >
                      <PropertyIcon
                        type={column.dataType}
                        formula={!!column.formula}
                        class="size-3.5 shrink-0 text-ink-muted"
                      />
                      <span class="truncate">{column.name}</span>
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
        </div>
        <p id={statusId} class="min-h-4" aria-live="polite">
          <Switch>
            <Match when={loadError()}>
              <span class="text-failure-ink">
                Formulas could not load. Try again.
              </span>
            </Match>
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
