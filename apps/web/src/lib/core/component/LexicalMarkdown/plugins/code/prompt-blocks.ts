import { $createCodeNode } from '@lexical/code';
import {
  $ensureForwardRangeSelection,
  $setBlocksType,
} from '@lexical/selection';
import { PROMPT_LANGUAGE } from '@macro-inc/lexical-core';
import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';

const PROMPT_BLOCK_EDITORS = new WeakSet<LexicalEditor>();

/** Offer prompt blocks in this editor: the `/prompt` action and the code block type. */
export function registerPromptBlocks(editor: LexicalEditor) {
  PROMPT_BLOCK_EDITORS.add(editor);
  return () => {
    PROMPT_BLOCK_EDITORS.delete(editor);
  };
}

export function hasPromptBlocks(editor: LexicalEditor) {
  return PROMPT_BLOCK_EDITORS.has(editor);
}

/** Turn the selected blocks into prompt blocks, as the Code action does for code. */
export function $setSelectionToPromptBlock() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  // Lexical excludes a focus at a block's start, even for backward ranges.
  const forwardSelection = selection.clone();
  $ensureForwardRangeSelection(forwardSelection);
  $setBlocksType(forwardSelection, () => $createCodeNode(PROMPT_LANGUAGE));
}
