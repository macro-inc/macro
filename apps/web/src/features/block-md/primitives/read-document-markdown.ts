import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import type { MarkdownDocumentState } from '../context/markdown-document-state';

type DocumentBody = Pick<
  MarkdownDocumentState['editor']['md'],
  'editor' | 'nativeRuntime'
>;

/**
 * External markdown from the document body's model, preferring its native
 * runtime. As Source's prompt builder does, a body that has no editor yet
 * reads as empty and a model is read whether or not its view is attached.
 */
export function readDocumentMarkdown(body: DocumentBody): string {
  if (body.nativeRuntime)
    return body.nativeRuntime.executor.session.markdown(1);
  return body.editor ? editorStateAsMarkdown(body.editor, 'external') : '';
}
