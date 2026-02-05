import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { createMarkdownFile } from './create';

export async function createFromMarkdownText(args: {
  markdown: string;
  title?: string;
}): Promise<{ documentId: string } | { error: string }> {
  const { markdown, title } = args;
  const documentId = await createMarkdownFile({
    title,
    content: markdown,
  });
  if (!documentId) return { error: 'Failed to create document' };
  return { documentId };
}

export async function transformMarkdownText(args: {
  markdown: string;
}): Promise<{ json: string } | { error: string }> {
  const { markdown } = args;
  const { editor, cleanup } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'block-md-disposable',
    isInteractable: () => false,
  });
  setEditorStateFromMarkdown(editor, markdown, 'external');
  const state = JSON.stringify(editor.getEditorState().toJSON());
  cleanup();
  return { json: state };
}
