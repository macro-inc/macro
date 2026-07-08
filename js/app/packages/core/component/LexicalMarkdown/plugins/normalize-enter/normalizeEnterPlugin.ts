import {
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  type ElementNode,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';

const isEmptyOrMatches = (str: string, regex: RegExp) =>
  str === '' || regex.test(str);

/**
 * Normalizes Enter behavior for the markdown editor:
 * - Enter in a heading creates a paragraph next, including when splitting a
 *   heading in the middle.
 * - Enter at the start of a non-empty quote inserts a quote before it.
 * - Enter in an empty quote converts it back to a paragraph.
 * - Enter into an empty paragraph clears pending inline text format and style.
 * - Shift+Enter at the start of an empty paragraph falls back to a normal
 *   paragraph split instead of inserting a line break.
 */
function $testSelectionPosition(
  selection: RangeSelection,
  parent: ElementNode
) {
  return (
    selection.focus.type === 'text' &&
    selection.focus.offset === 0 &&
    selection.focus.getNode() === parent.getFirstChild()
  );
}

/**
 * Returns true if the selection is at the start of an empty paragraph or is
 * directly preceded by a line break.
 */
function $isAtStartOfEmptyParagraph(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const node = selection.anchor.getNode();
  const parentElement = node.getParent();

  // check for preceding line break node
  if (selection.anchor.type === 'element') {
    if ($isElementNode(node)) {
      const offsetNode = node.getChildAtIndex(selection.anchor.offset);
      if ($isLineBreakNode(offsetNode)) {
        return true;
      }
    }
  }

  if (selection.anchor.offset !== 0) {
    return false;
  }

  if ($isParagraphNode(parentElement)) {
    return isEmptyOrMatches(parentElement.getTextContent().trim(), /^$/);
  }
  if ($isRootNode(parentElement)) {
    return isEmptyOrMatches(node.getTextContent().trim(), /^$/);
  }
  return false;
}

/**
 * Normalize enter at start of block elements.
 * QuoteNode - mirrors heading node behavior and notion.
 */
function $handleEnterAtBlockStart(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const selectionNode = selection.focus.getNode();

  const rootParent = selectionNode.getTopLevelElement();
  if (!rootParent) return false;

  if ($isQuoteNode(rootParent)) {
    if (rootParent.getTextContent() === '') {
      const paragraph = $createParagraphNode();
      rootParent.replace(paragraph);
      paragraph.selectStart();
      return true;
    }
    if ($testSelectionPosition(selection, rootParent)) {
      rootParent.insertBefore($createQuoteNode());
      return true;
    }
  }
  return false;
}

function $clearInlineStylesIfEmptyParagraph(node: ElementNode): void {
  if (!$isParagraphNode(node) || node.getTextContent().trim() !== '') {
    return;
  }

  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.setFormat(0);
    selection.setStyle('');
  }
}

function $clearInlineStylesAtEmptyParagraphSelection(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return;
  }

  const node = selection.anchor.getNode();
  const paragraph = $isParagraphNode(node) ? node : node.getTopLevelElement();
  if ($isElementNode(paragraph)) {
    $clearInlineStylesIfEmptyParagraph(paragraph);
  }
}

function scheduleInlineStyleCleanup(editor: LexicalEditor): void {
  setTimeout(() => {
    editor.update(() => {
      $clearInlineStylesAtEmptyParagraphSelection();
    });
  }, 0);
}

/**
 * Lexical keeps the heading type when a heading is split in the middle. Notion
 * always makes the next block a paragraph, including the split-off text.
 */
function $handleEnterFromHeading(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  const anchorBlock = selection.anchor.getNode().getTopLevelElement();
  const focusBlock = selection.focus.getNode().getTopLevelElement();
  if (!$isHeadingNode(anchorBlock) || anchorBlock !== focusBlock) {
    return false;
  }

  const nextBlock = selection.insertParagraph();
  if (!$isElementNode(nextBlock)) {
    return false;
  }

  if ($isHeadingNode(nextBlock)) {
    const paragraph = $createParagraphNode();
    paragraph.setDirection(nextBlock.getDirection());
    paragraph.setIndent(nextBlock.getIndent());
    nextBlock.replace(paragraph, true);
    paragraph.selectStart();
    $clearInlineStylesIfEmptyParagraph(paragraph);
    return true;
  }

  $clearInlineStylesIfEmptyParagraph(nextBlock);
  return true;
}

function registerNormalizeEnterPlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event) return false;
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }
        if ($handleEnterFromHeading()) {
          event.preventDefault();
          return true;
        }
        const res = $handleEnterAtBlockStart();
        if (res) event.preventDefault();
        else scheduleInlineStyleCleanup(editor);
        return res;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      INSERT_PARAGRAPH_COMMAND,
      () => {
        scheduleInlineStyleCleanup(editor);
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e) => {
        if (e?.shiftKey) {
          if ($isAtStartOfEmptyParagraph()) {
            e.preventDefault();
            editor.dispatchCommand(KEY_ENTER_COMMAND, null);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    )
  );
}

export function normalizeEnterPlugin() {
  return (editor: LexicalEditor) => {
    return registerNormalizeEnterPlugin(editor);
  };
}
