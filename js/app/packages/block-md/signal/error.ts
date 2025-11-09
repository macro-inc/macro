import { createBlockSignal } from '@core/block';
import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';

export const markdownBlockErrorSignal =
  createBlockSignal<MarkdownEditorErrors | null>(null);
