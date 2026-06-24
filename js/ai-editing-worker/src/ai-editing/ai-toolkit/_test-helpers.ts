import { $getRoot } from 'lexical';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import { numberLines, serializeWithXml } from '../utils';
import { createEditingSession, loadMarkdown, type Session } from './session';

/** Run a `$`-helper inside a discrete update so it commits before we assert. */
export function edit<T>(session: Session, fn: () => T): T {
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
export function read<T>(session: Session, fn: () => T): T {
  return session.editor.getEditorState().read(fn);
}

/** Durable ids of the top-level blocks, in document order. */
export function topLevelIds(session: Session): string[] {
  return read(session, () =>
    $getRoot()
      .getChildren()
      .map((c) => $getId(c) ?? '?')
  );
}

// this is just a test helper, and the markdown it creates isn't pretty but
// makes assertions easier
export function setup(md: string): { session: Session; ids: string[] } {
  const session = createEditingSession();
  loadMarkdown(session, md);
  return { session, ids: topLevelIds(session) };
}

/**
 * Serialization with the `N | ` line-number prefix stripped for asserting
 * document *content* (the line numbers are a presentation detail). (since the
 * ai sees it with line numbers)
 **/
export function serializedWithoutLinePrefix(session: Session): string {
  return numberLines(serializeWithXml(session))
    .split('\n')
    .map((line) => line.replace(/^\d+ \| /, ''))
    .join('\n');
}
