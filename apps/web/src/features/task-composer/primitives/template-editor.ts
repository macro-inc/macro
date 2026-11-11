import type { TaskTemplateContents } from '@app/features/task-templates/core/template';
import { $removeNodeAndRestoreSelection } from '@core/component/LexicalMarkdown/plugins/shared/removeNodeAndRestoreSelection';
import {
  editorStateAsMarkdown,
  setEditorStateFromMarkdown,
} from '@core/component/LexicalMarkdown/utils';
import { $dfs } from '@lexical/utils';
import { $isImageNode, $isVideoNode } from '@macro-inc/lexical-core';
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

/** Template descriptions reuse rich text but never inherit task attachments. */
export function removeTemplateAttachments(
  editor: LexicalEditor | undefined
): string | undefined {
  if (!editor) return undefined;
  editor.update(
    () => {
      for (const { node } of $dfs()) {
        if ($isImageNode(node) || $isVideoNode(node))
          $removeNodeAndRestoreSelection(node);
      }
    },
    { discrete: true }
  );
  return editorStateAsMarkdown(editor);
}
