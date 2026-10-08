import { mergeRegister } from '@lexical/utils';
import { $isDocumentMentionNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  createCommand,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  type ParagraphNode,
} from 'lexical';

export const INSERT_INLINE_TASK_DRAFT_COMMAND: LexicalCommand<void> = createCommand(
  'INSERT_INLINE_TASK_DRAFT_COMMAND'
);
export const CONTINUE_INLINE_TASK_DRAFT_COMMAND: LexicalCommand<NodeKey> = createCommand(
  'CONTINUE_INLINE_TASK_DRAFT_COMMAND'
);

function $taskAtLineEnd(paragraph: ParagraphNode, offset: number): boolean {
  const children = paragraph.getChildren();
  const task = children.findLast(
    (child) => !($isTextNode(child) && child.getTextContent().trim() === '')
  );
  if (!$isDocumentMentionNode(task) || task.getBlockName() !== 'task') return false;
  const index = task.getIndexWithinParent();
  if (offset <= index) return false;
  return children.slice(index + 1).every((child) =>
    $isTextNode(child) && child.getTextContent().trim() === ''
  );
}

/** A task line also ends at the boundary before its trailing whitespace. */
function $getTaskParagraphAtEnd(): ParagraphNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const node = anchor.getNode();
  const paragraph = $isParagraphNode(node) ? node : node.getParent();
  if (!$isParagraphNode(paragraph) || !$isRootNode(paragraph.getParent())) return null;

  let offset: number;
  if (anchor.type === 'element' && node === paragraph) {
    offset = anchor.offset;
  } else if ($isTextNode(node) && anchor.type === 'text') {
    if (node.getTextContent().slice(anchor.offset).trim() !== '') return null;
    offset = node.getIndexWithinParent() + (anchor.offset === 0 ? 0 : 1);
  } else {
    return null;
  }
  return $taskAtLineEnd(paragraph, offset) ? paragraph : null;
}

/** Draft state belongs to the host, not to serialized Lexical nodes. */
export function registerInlineTaskDraftPlugin(
  editor: LexicalEditor,
  options: {
    canEdit: () => boolean;
    isInlineMenuOpen: () => boolean;
    draftStatus: (key: NodeKey) => 'editable' | 'reserved' | undefined;
    onDraft: (paragraphKey: NodeKey) => void;
  }
) {
  let ignoreParagraphFromKey = false;
  const canStart = () => options.canEdit() && editor.isEditable() && !editor.isComposing();

  const $focusDraft = (paragraph: ParagraphNode) => {
    const selection = paragraph.selectStart();
    selection.setFormat(0);
    selection.setStyle('');
    options.onDraft(paragraph.getKey());
    return true;
  };

  const $continueAfter = (paragraph: ParagraphNode) => {
    const next = paragraph.getNextSibling();
    if ($isParagraphNode(next) && next.getChildrenSize() === 0 &&
        options.draftStatus(next.getKey()) !== 'reserved') {
      if (!options.draftStatus(next.getKey())) {
        next.setIndent(paragraph.getIndent());
        next.setDirection(paragraph.getDirection());
      }
      return $focusDraft(next);
    }
    const draft = $createParagraphNode();
    draft.setIndent(paragraph.getIndent());
    draft.setDirection(paragraph.getDirection());
    paragraph.insertAfter(draft);
    return $focusDraft(draft);
  };

  const $continueFromSelection = () => {
    if (!canStart() || options.isInlineMenuOpen()) return false;
    const paragraph = $getTaskParagraphAtEnd();
    return paragraph ? $continueAfter(paragraph) : false;
  };

  const $insertDraft = () => {
    if (!canStart()) return false;
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    const anchor = selection.anchor.getNode();
    let block = anchor;
    while (block.getParent() && !$isRootNode(block.getParent())) {
      block = block.getParent()!;
    }
    if (!$isRootNode(block.getParent())) return false;
    if ($isParagraphNode(block) && selection.isCollapsed()) {
      if (block.getChildrenSize() === 0 && !options.draftStatus(block.getKey())) {
        return $focusDraft(block);
      }
      // Lexical splits the text at the caret, retaining both halves.
      if (!options.draftStatus(block.getKey()) && block.getChildrenSize() > 0 &&
          (anchor === block || anchor.getParent() === block)) {
        const after = selection.insertParagraph();
        if ($isParagraphNode(after)) {
          if (after.getChildrenSize() === 0) return $focusDraft(after);
          const draft = $createParagraphNode();
          draft.setIndent(block.getIndent());
          draft.setDirection(block.getDirection());
          after.insertBefore(draft);
          return $focusDraft(draft);
        }
      }
    }
    // Nested content remains untouched; the draft sits beside its top-level block.
    const draft = $createParagraphNode();
    if ($isParagraphNode(block)) {
      draft.setIndent(block.getIndent());
      draft.setDirection(block.getDirection());
    }
    block.insertAfter(draft);
    return $focusDraft(draft);
  };

  return mergeRegister(
    editor.registerCommand(INSERT_INLINE_TASK_DRAFT_COMMAND, $insertDraft, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(
      CONTINUE_INLINE_TASK_DRAFT_COMMAND,
      (key) => {
        if (!canStart()) return false;
        const task = $getNodeByKey(key);
        if (!$isDocumentMentionNode(task) || task.getBlockName() !== 'task') return false;
        const paragraph = task.getParent();
        if (!$isParagraphNode(paragraph) || !$isRootNode(paragraph.getParent()) ||
            !$taskAtLineEnd(paragraph, task.getIndexWithinParent() + 1)) return false;
        return $continueAfter(paragraph);
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event) return false;
        if (event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          ignoreParagraphFromKey = true;
          queueMicrotask(() => { ignoreParagraphFromKey = false; });
          return false;
        }
        if (!$continueFromSelection()) return false;
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => ignoreParagraphFromKey ? false : $continueFromSelection(),
      COMMAND_PRIORITY_HIGH
    )
  );
}
