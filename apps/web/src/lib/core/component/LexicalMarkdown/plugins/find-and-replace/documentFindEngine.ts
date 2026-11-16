import type { LexicalEditor } from 'lexical';
import { REVEAL_NODE_COMMAND } from '../heading-folds';
import {
  DO_REPLACE_COMMAND,
  DO_REPLACE_ONCE_COMMAND,
  DO_SEARCH_COMMAND,
  type NodekeyOffset,
} from './findAndReplacePlugin';

export type DocumentFindReplace = {
  replaceString: string;
  nodeKeyOffsetList: NodekeyOffset[];
};

/** The document find bar's editor seam; each editor engine supplies one. */
export interface DocumentFindEngine {
  /** Publishes the match list through the engine's own store callback. */
  search(query: string): void;
  replaceAll(payload: DocumentFindReplace): void;
  replaceOnce(payload: DocumentFindReplace): void;
  getElementByKey(key: string): HTMLElement | null;
  /** Makes a match visible before scrolling to it, e.g. unfolding its heading. */
  reveal(key: string): void;
}

/** Source engine: the findAndReplacePlugin commands, unchanged. */
export function createLexicalDocumentFind(
  editor: LexicalEditor
): DocumentFindEngine {
  return {
    search(query) {
      editor.dispatchCommand(DO_SEARCH_COMMAND, query);
    },
    replaceAll(payload) {
      editor.dispatchCommand(DO_REPLACE_COMMAND, payload);
    },
    replaceOnce(payload) {
      editor.dispatchCommand(DO_REPLACE_ONCE_COMMAND, payload);
    },
    getElementByKey: (key) => editor.getElementByKey(key),
    reveal(key) {
      editor.dispatchCommand(REVEAL_NODE_COMMAND, key);
    },
  };
}
