import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from '@core/component/LexicalMarkdown/plugins';
import {
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';

export function applyInlineFormat(
  editor: LexicalEditor,
  format: TextFormatType
) {
  try {
    editor.focus();
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  } catch {
    console.error('failed to apply formatting');
  }
}

export function applyNodeFormat(
  editor: LexicalEditor,
  format: NodeTransformType
) {
  try {
    editor.focus();
    editor.dispatchCommand(NODE_TRANSFORM, format);
  } catch {
    console.error('failed to apply formatting');
  }
}
