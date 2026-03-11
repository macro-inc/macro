import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  editorStateAsMarkdown,
  initializeEditorWithState,
} from '@core/component/LexicalMarkdown/utils';
import { syncServiceClient } from '@service-sync/client';

/**
 * Fetches a document from the sync service and returns its content as markdown text.
 * @param documentId The ID of the document to fetch
 * @param target 'external' for GFM-compatible markdown, 'internal' for round-trip compatible markdown
 * @returns The document content as a markdown string, or null if the document is empty
 */
export async function fetchDocumentAsMarkdown(
  documentId: string,
  target: 'external' | 'internal' = 'external'
): Promise<string | null> {
  const rawState = await syncServiceClient.getRaw({ documentId });
  if (!rawState || !rawState.root || rawState.root.children.length === 0) {
    return null;
  }
  const { editor } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'document-markdown-extractor',
    isInteractable: () => false,
  });
  initializeEditorWithState(editor, rawState);
  const markdown = editorStateAsMarkdown(editor, target);
  return markdown;
}
