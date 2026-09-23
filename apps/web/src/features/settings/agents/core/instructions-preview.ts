import { $convertFromMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS, SupportedNodeTypes } from '@macro-inc/lexical-core';
import { $getRoot, createEditor } from 'lexical';

/** Keep the list summary readable without changing the saved instructions. */
export function agentInstructionsPreview(markdown: string): string {
  if (!markdown.trim()) return '';
  const editor = createEditor({ nodes: SupportedNodeTypes });
  editor.update(() => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS), {
    discrete: true,
  });
  return editor
    .getEditorState()
    .read(() => $getRoot().getTextContent().replace(/\s+/g, ' ').trim());
}
