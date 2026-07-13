import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $getRoot } from 'lexical';
import {
  createEditingSession,
  type LexicalSession,
  loadMarkdown,
} from './session';

/** Run a `$`-helper inside a discrete update so it commits before we assert. */
export function edit<T>(session: LexicalSession, fn: () => T): T {
  let result!: T;
  session.editor.update(
    () => {
      result = fn();
    },
    { discrete: true }
  );
  return result;
}

/** Read inside the editor state. */
export function read<T>(session: LexicalSession, fn: () => T): T {
  return session.editor.getEditorState().read(fn);
}

/** Durable ids of the top-level blocks, in document order. */
export function topLevelIds(session: LexicalSession): string[] {
  return read(session, () =>
    $getRoot()
      .getChildren()
      .map((c) => $getId(c) ?? '?')
  );
}

// this is just a test helper, and the markdown it creates isn't pretty but
// makes assertions easier
export function setup(md: string): { session: LexicalSession; ids: string[] } {
  const session = createEditingSession();
  loadMarkdown(session, md);
  return { session, ids: topLevelIds(session) };
}
