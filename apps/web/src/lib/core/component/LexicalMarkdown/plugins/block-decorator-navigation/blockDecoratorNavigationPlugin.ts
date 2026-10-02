import { mergeRegister } from '@lexical/utils';
import {
  $createNodeSelection,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isNodeSelection,
  $isRangeSelection,
  $isRootNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  type DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from 'lexical';
import { $getCaretRect } from '../../utils';

/**
 * Block decorators that arrow keys stop on: the first press selects the block,
 * the next moves past it. Lexical only stops on decorators inside one element.
 */
const STOPPING_BLOCK_TYPES = new Set([
  'image',
  'video',
  'horizontalrule',
  'database-query',
]);

type Direction = 'up' | 'down';

function $isStoppingBlock(
  node: LexicalNode | null | undefined
): node is DecoratorNode<unknown> {
  return (
    $isDecoratorNode(node) &&
    !node.isInline() &&
    node.isKeyboardSelectable() &&
    STOPPING_BLOCK_TYPES.has(node.getType())
  );
}

function $selectBlock(node: LexicalNode) {
  const selection = $createNodeSelection();
  selection.add(node.getKey());
  $setSelection(selection);
}

/** No wrapped line of `block` lies beyond the caret in `direction`. */
function $isCaretOnEdgeLine(
  editor: LexicalEditor,
  block: LexicalNode,
  direction: Direction
) {
  const element = editor.getElementByKey(block.getKey());
  const caret = $getCaretRect();
  if (!element || !caret) return false;
  const bounds = element.getBoundingClientRect();
  const beyond =
    direction === 'down'
      ? bounds.bottom - caret.bottom
      : caret.top - bounds.top;
  return beyond < Math.max(caret.height, 1);
}

function $neighbor(node: LexicalNode, direction: Direction) {
  return direction === 'down'
    ? node.getNextSibling()
    : node.getPreviousSibling();
}

/** The block a caret sitting on the root (between blocks) steps onto; `undefined` when the caret is inside a block. */
function $blockBesideRootCaret(
  selection: RangeSelection,
  direction: Direction
): LexicalNode | null | undefined {
  const root = selection.focus.getNode();
  if (!$isRootNode(root)) return undefined;
  const offset = selection.focus.offset;
  return root.getChildAtIndex(direction === 'down' ? offset : offset - 1);
}

function $stopOnBlock(
  editor: LexicalEditor,
  event: KeyboardEvent | null,
  direction: Direction
) {
  if (event?.shiftKey) return false;
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    const [node] = selection.getNodes();
    if (selection.getNodes().length !== 1 || !$isStoppingBlock(node))
      return false;
    const next = $neighbor(node, direction);
    if (!$isStoppingBlock(next)) return false;
    event?.preventDefault();
    $selectBlock(next);
    return true;
  }
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const between = $blockBesideRootCaret(selection, direction);
  if (between !== undefined) {
    if (!$isStoppingBlock(between)) return false;
    event?.preventDefault();
    $selectBlock(between);
    return true;
  }
  const block = selection.focus.getNode().getTopLevelElement();
  if (!block) return false;
  const next = $neighbor(block, direction);
  if (!$isStoppingBlock(next)) return false;
  if (!$isCaretOnEdgeLine(editor, block, direction)) return false;
  event?.preventDefault();
  $selectBlock(next);
  return true;
}

export function blockDecoratorNavigationPlugin() {
  return (editor: LexicalEditor) =>
    mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => $stopOnBlock(editor, event, 'down'),
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => $stopOnBlock(editor, event, 'up'),
        COMMAND_PRIORITY_LOW
      )
    );
}

/** Enter the document from above (e.g. the title), selecting a block decorator that opens it. */
export function $selectDocumentStart() {
  const first = $getRoot().getFirstChild();
  if ($isStoppingBlock(first)) $selectBlock(first);
  else first?.selectStart();
}
