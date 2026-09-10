import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';

export function isMarkdownEditorLoading(
  editorReady: boolean,
  editorError: MarkdownEditorErrors | null
): boolean {
  return !editorReady && editorError === null;
}
