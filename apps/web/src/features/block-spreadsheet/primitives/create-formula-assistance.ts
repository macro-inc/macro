import { fireAndForget } from '@core/util/fireAndForget';
import type { CompletionContext } from '@ironcalc/wasm';
import { createSignal, onCleanup } from 'solid-js';
import {
  type FormulaCompletion,
  formulaCompletion,
  insertFunction,
  type TableReferences,
  tableCompletion,
} from '../core/formula-completion';
import { SPREADSHEET_MAX_CELL_LENGTH } from '../core/spreadsheet-document';

export type CompleteFormula = (
  text: string,
  cursor: number
) => Promise<CompletionContext | undefined>;

/** Coalesce keystrokes while the worker loads; never replace a newer draft with old help. */
export function createFormulaAssistance(
  complete: CompleteFormula,
  replace: (text: string, cursor: number) => void,
  /** Tables to suggest; their names and columns complete without the worker. */
  tables?: () => TableReferences | undefined
) {
  const [completion, setCompletion] = createSignal<FormulaCompletion>();
  const [selected, setSelected] = createSignal(0);
  let latest: { text: string; cursor: number } | undefined;
  let shown: typeof latest;
  let running = false;
  let version = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    version++;
  });

  function dismiss() {
    version++;
    latest = undefined;
    shown = undefined;
    setCompletion(undefined);
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (latest && !disposed) {
        const request = latest;
        const current = version;
        latest = undefined;
        try {
          const context = await complete(request.text, request.cursor);
          if (!disposed && current === version) {
            shown = request;
            setSelected(0);
            setCompletion(
              context ? formulaCompletion(request.text, context) : undefined
            );
          }
        } catch {
          // Formula help is optional: a failed helper must never block typing or commit.
          if (!disposed && current === version) setCompletion(undefined);
        }
      }
    } finally {
      running = false;
    }
  }

  function update(text: string, cursor: number, selectionEnd = cursor) {
    if (!text.startsWith('=') || cursor !== selectionEnd) {
      dismiss();
      return;
    }
    const previous = latest ?? shown;
    if (previous?.text === text && previous.cursor === cursor) return;
    version++;
    const references = tables?.();
    const local = references && tableCompletion(text, cursor, references);
    if (local) {
      latest = undefined;
      shown = { text, cursor };
      setSelected(0);
      setCompletion(local);
      return;
    }
    latest = { text, cursor };
    shown = undefined;
    setCompletion(undefined);
    fireAndForget(drain(), 'spreadsheet-editor');
  }

  function accept(index = selected()) {
    const result = completion();
    if (!shown) return;
    let next: { text: string; cursor: number } | undefined;
    if (result?.kind === 'references') {
      const item = result.items[index];
      if (!item) return;
      next = {
        text:
          shown.text.slice(0, result.from) +
          item.insert +
          shown.text.slice(result.to),
        cursor: result.from + item.insert.length,
      };
    } else if (result?.kind === 'list') {
      const name = result.names[index];
      if (!name) return;
      next = insertFunction(shown.text, shown.cursor, result.from, name);
    }
    if (!next) return;
    dismiss();
    if (next.text.length > SPREADSHEET_MAX_CELL_LENGTH) return;
    replace(next.text, next.cursor);
    update(next.text, next.cursor);
  }

  function keyDown(event: KeyboardEvent) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
      return false;
    const result = completion();
    if (event.key === 'Escape' && result) {
      event.preventDefault();
      dismiss();
      return true;
    }
    const count =
      result?.kind === 'list'
        ? result.names.length
        : result?.kind === 'references'
          ? result.items.length
          : 0;
    if (!count) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((index) => (index + delta + count) % count);
      return true;
    }
    if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'Enter') {
      event.preventDefault();
      accept();
      return true;
    }
    return false;
  }
  return {
    completion,
    selected,
    setSelected,
    update,
    dismiss,
    accept,
    keyDown,
  };
}
