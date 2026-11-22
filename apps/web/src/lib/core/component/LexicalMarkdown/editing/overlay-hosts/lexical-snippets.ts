import { fetchSnippetRaw } from '@queries/storage/snippets';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import {
  CLOSE_SNIPPET_SEARCH_COMMAND,
  INSERT_SNIPPET_COMMAND,
} from '../../plugins/snippets';
import type { SnippetMenuHost } from './snippets';

/** Keep Source fetching lazy and owned by the actual snippet plugin. */
export function createLexicalSnippetMenuHost(
  editor: Accessor<LexicalEditor>
): SnippetMenuHost {
  return {
    root: () => editor().getRootElement(),
    closeSearch() {
      editor().dispatchCommand(CLOSE_SNIPPET_SEARCH_COMMAND, undefined);
    },
    insertSnippet(documentId, sourceDocumentId) {
      editor().dispatchCommand(INSERT_SNIPPET_COMMAND, {
        documentId,
        sourceDocumentId,
        fetchSnippet: () => fetchSnippetRaw({ documentId }),
      });
    },
  };
}
