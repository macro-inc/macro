import { NodeReplacements, SupportedNodeTypes } from '@macro-inc/lexical-core';
import { createEditor, type LexicalEditor } from 'lexical';
import { afterEach } from 'vitest';

const CLEANUPS: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of CLEANUPS.splice(0).reverse()) cleanup();
});

// Import the production API normally: the engine resolver must switch these
// tests and their real plugins together. Never substitute a mocked core.
export function behaviorEditor(
  ...plugins: ((editor: LexicalEditor) => () => void)[]
) {
  const editor = createEditor({
    namespace: 'behavior-inventory',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError(error) {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  CLEANUPS.push(() => {
    editor.setRootElement(null);
    root.remove();
  });
  for (const plugin of plugins) CLEANUPS.push(plugin(editor));
  return { editor, root };
}
