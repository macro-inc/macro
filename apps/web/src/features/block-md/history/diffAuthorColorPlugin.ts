import { DiffTextNode } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import { userColor } from './utils';

/** Apply app theme colors to rendered document-history diff runs. */
export function diffAuthorColorPlugin(editor: LexicalEditor): () => void {
  return editor.registerMutationListener(
    DiffTextNode,
    (mutations) => {
      for (const [nodeKey, mutation] of mutations) {
        if (mutation === 'destroyed') continue;

        const element = editor.getElementByKey(nodeKey);
        const author = element?.dataset.diffAuthor;
        if (!element || !author) continue;

        element.style.setProperty('--diff-author-color', userColor(author));
      }
    },
    { skipInitialization: false }
  );
}
