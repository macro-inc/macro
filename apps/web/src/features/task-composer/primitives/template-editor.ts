import type { TaskTemplateContents } from '@app/features/task-templates/core/template';
import {
  editorStateAsMarkdown,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import type { LexicalEditor } from 'lexical';

/** Use the editor's canonical Markdown for both the draft and its pristine baseline. */
export function applyTemplateToEditor(
  template: TaskTemplateContents,
  editor: LexicalEditor | undefined
): TaskTemplateContents {
  if (!editor) return template;
  setEditorStateFromMarkdown(editor, template.descriptionMarkdown);
  return { ...template, descriptionMarkdown: editorStateAsMarkdown(editor) };
}
