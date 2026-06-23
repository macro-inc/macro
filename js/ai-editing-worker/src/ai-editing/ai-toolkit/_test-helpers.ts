import { $getRoot } from 'lexical';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
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

/** Serialization with the `N | ` line-number prefix stripped — for asserting
 *  document *content* (the line numbers are a presentation detail). */
export function serializedWithoutLinePrefix(s: Session): string {
  return serializeWithIds(s)
    .split('\n')
    .map((line) => line.replace(/^\d+ \| /, ''))
    .join('\n');
}
