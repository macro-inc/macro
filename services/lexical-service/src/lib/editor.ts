import { createHeadlessEditor } from '@lexical/headless';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';

export function createEditor() {
  const editor = createHeadlessEditor({
    nodes: SupportedNodeTypes,
  });

  return editor;
}
