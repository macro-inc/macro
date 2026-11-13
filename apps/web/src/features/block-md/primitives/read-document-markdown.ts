import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import type { MarkdownDocumentState } from '../context/markdown-document-state';

type DocumentBody = Pick<
  MarkdownDocumentState['editor']['md'],
  'editor' | 'nativeRuntime'
>;

/** External markdown from the mounted document body; an empty body is valid. */
export function readDocumentMarkdown(body: DocumentBody): string {
  const runtime = body.nativeRuntime;
  if (runtime) {
    if (!runtime.view.isMounted)
      throw new Error('Document body is not mounted');
    return runtime.executor.session.markdown(1);
  }

  const editor = body.editor;
  const root = editor?.getRootElement();
  if (!editor || !root?.isConnected)
    throw new Error('Document body is not mounted');
  return editorStateAsMarkdown(editor, 'external');
}
