import * as A from '@automerge/automerge';
import {
  type AutomergeDoc,
  type DocEvent,
  isList,
  type Value,
} from './document';

type Item = { before: string[]; after: string[]; value?: Value };
type Options = {
  mergeInterval?: number;
  maxUndoSteps?: number;
  excludeOriginPrefixes?: string[];
  onPush?: (
    undo: boolean,
    range: unknown,
    event?: DocEvent
  ) => { value: Value; cursors: unknown[] };
};

/** Inverses run against the original change heads. Automerge merges them with
 * later peer operations, so undo does not replace the current shared snapshot.
 */
export class UndoManager {
  private undoStack: Item[] = [];
  private redoStack: Item[] = [];
  private unsubscribe: () => void;
  private grouped = false;
  private groupFirst = false;
  private time = 0;
  private applying = false;
  constructor(
    private readonly doc: AutomergeDoc,
    private readonly options: Options = {}
  ) {
    doc.commit();
    this.unsubscribe = doc.subscribe((event) => {
      if (
        this.applying ||
        event.by !== 'local' ||
        options.excludeOriginPrefixes?.some((prefix) =>
          event.origin.startsWith(prefix)
        )
      )
        return;
      const last = this.undoStack.at(-1);
      const contiguous =
        last && JSON.stringify(last.after) === JSON.stringify(event.from);
      if (
        contiguous &&
        ((!this.groupFirst && this.grouped) ||
          (!this.groupFirst &&
            Date.now() - this.time < (options.mergeInterval ?? 0)))
      )
        last.after = event.to;
      else
        this.undoStack.push({
          before: event.from,
          after: event.to,
          value: options.onPush?.(true, undefined, event).value,
        });
      this.undoStack = this.undoStack.slice(-(options.maxUndoSteps ?? 100));
      this.groupFirst = false;
      this.redoStack = [];
      this.time = Date.now();
    });
  }
  private apply(from: Item[], to: Item[], undo: boolean) {
    this.doc.commit();
    const item = from.pop();
    if (!item) return;
    const desired = A.view(this.doc.value, item.before);
    this.applying = true;
    try {
      const inverse = this.doc.changeAt(item.after, (draft) =>
        restore(draft, desired)
      );
      to.push({
        before: item.after,
        after: inverse,
        value: this.options.onPush?.(undo, undefined).value,
      });
    } catch (error) {
      from.push(item);
      throw error;
    } finally {
      this.applying = false;
    }
  }
  undo() {
    this.apply(this.undoStack, this.redoStack, false);
  }
  redo() {
    this.apply(this.redoStack, this.undoStack, true);
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  topUndoValue() {
    return this.undoStack.at(-1)?.value;
  }
  topRedoValue() {
    return this.redoStack.at(-1)?.value;
  }
  groupStart() {
    this.grouped = true;
    this.groupFirst = true;
    this.time = 0;
  }
  groupEnd() {
    this.grouped = false;
    this.time = 0;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
  free() {
    this.unsubscribe();
    this.clear();
  }
}

// Preserve native text versus scalar strings when restoring deleted fields.
function copy(value: any): any {
  if (value instanceof A.ImmutableString)
    return new A.ImmutableString(value.toString());
  if (value instanceof A.Counter) return new A.Counter(Number(value));
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, copy(child)])
    );
  return value;
}
function restore(
  draft: any,
  desired: any,
  root = draft,
  path: (string | number)[] = []
) {
  if (Array.isArray(desired)) {
    const target = desired.map(String);
    for (let index = draft.length - 1; index >= 0; index--)
      if (!target.includes(String(draft[index]))) draft.splice(index, 1);
    for (let index = 0; index < desired.length; index++) {
      if (String(draft[index]) === String(desired[index])) continue;
      const found = draft.findIndex(
        (value: any, i: number) =>
          i > index && String(value) === String(desired[index])
      );
      if (found >= 0) draft.splice(found, 1);
      draft.splice(index, 0, copy(desired[index]));
    }
    if (draft.length > desired.length) draft.splice(desired.length);
    return;
  }
  for (const key of Object.keys(draft))
    if (!(key in desired)) {
      if (path.length === 0) {
        if (isList(draft[key])) draft[key].order.splice(0);
        else if (typeof draft[key] === 'string') A.updateText(root, [key], '');
        else
          for (const child of Object.keys(draft[key])) delete draft[key][child];
      } else delete draft[key];
    }
  for (const [key, next] of Object.entries(desired)) {
    const current = draft[key];
    if (typeof next === 'string' && typeof current === 'string')
      A.updateText(root, [...path, key], next);
    else if (
      next &&
      typeof next === 'object' &&
      !(next instanceof A.ImmutableString) &&
      !(next instanceof A.Counter)
    ) {
      if (
        current &&
        typeof current === 'object' &&
        !(current instanceof A.ImmutableString) &&
        Array.isArray(current) === Array.isArray(next)
      )
        restore(current, next, root, [...path, key]);
      else draft[key] = copy(next);
    } else if (
      JSON.stringify(current) !== JSON.stringify(next) ||
      typeof current !== typeof next
    )
      draft[key] = copy(next);
  }
}
