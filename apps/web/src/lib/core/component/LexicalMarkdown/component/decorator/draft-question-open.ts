import type { LexicalEditor, NodeKey } from 'lexical';

/**
 * Question blocks whose editor opens, focusing its prompt, when they mount:
 * ones this page just inserted. A draft a collaborator inserted, or one
 * already in a document that opens, mounts closed, so focus stays wherever
 * the person is typing.
 */
const pending = new WeakMap<LexicalEditor, Set<NodeKey>>();

/** Asks the question block `key`, inserted here, to open its editor when it mounts. */
export function openDraftQuestionOnMount(
  editor: LexicalEditor,
  key: NodeKey
): void {
  const keys = pending.get(editor) ?? new Set<NodeKey>();
  keys.add(key);
  pending.set(editor, keys);
}

/** Whether the question block `key` should open its editor; true once at most. */
export function takeDraftQuestionOpen(
  editor: LexicalEditor,
  key: NodeKey
): boolean {
  return pending.get(editor)?.delete(key) ?? false;
}
