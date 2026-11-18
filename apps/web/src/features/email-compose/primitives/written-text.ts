import { $isClassedBlockNode } from '@macro-inc/lexical-core';
import { $getRoot, type LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** The text the user wrote, above the quoted thread a reply carries. */
export function $writtenText(): string {
  const lines: string[] = [];
  for (const node of $getRoot().getChildren()) {
    if ($isClassedBlockNode(node) && node.__classes.includes('macro_quote'))
      break;
    lines.push(node.getTextContent());
  }
  return lines.join('\n');
}

/** The editor's written text, kept current as it changes. */
export function createWrittenText(
  editor: Accessor<LexicalEditor | undefined>
): Accessor<string> {
  const [text, setText] = createSignal('');
  createEffect(() => {
    const current = editor();
    if (!current) return;
    setText(current.getEditorState().read($writtenText));
    onCleanup(
      current.registerUpdateListener(({ editorState }) => {
        setText(editorState.read($writtenText));
      })
    );
  });
  return text;
}
