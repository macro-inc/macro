import { $getRoot } from 'lexical';
import { $getId } from '../../plugins/nodeIdPlugin';
import { serializeWithIds } from '../utils';
import { createEditingSession, loadMarkdown, type Session } from './session';

/** Run a `$`-helper inside a discrete update so it commits before we assert. */
export function edit<T>(s: Session, fn: () => T): T {
  let result!: T;
  s.editor.update(
    () => {
      result = fn();
    },
    { discrete: true }
  );
  return result;
}

/** Read inside the editor state. */
export function read<T>(s: Session, fn: () => T): T {
  return s.editor.getEditorState().read(fn);
}

/** Durable ids of the top-level blocks, in document order. */
export function topLevelIds(s: Session): string[] {
  return read(s, () => $getRoot().getChildren().map((c) => $getId(c) ?? '?'));
}

export function setup(md: string): { s: Session; ids: string[] } {
  const s = createEditingSession();
  loadMarkdown(s, md);
  return { s, ids: topLevelIds(s) };
}
