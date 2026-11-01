import { $insertGeneratedNodes } from '@lexical/clipboard';
import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $parseSerializedNode,
  COMMAND_PRIORITY_LOW,
  createEditor,
  type LexicalEditor,
  PASTE_COMMAND,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
} from 'lexical';
import { setEditorStateFromMarkdown } from '../../utils';

function registerMarkdownPastePlugin(editor: LexicalEditor) {
  const parseEditor = createEditor({
    namespace: 'paste-parser',
    editable: false,
    nodes: [...Array.from(editor._nodes.values()).map((node) => node.klass)],
  });

  let shiftDown = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Shift') {
      shiftDown = true;
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Shift') {
      shiftDown = false;
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return mergeRegister(
    editor.registerCommand(
      SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
      ({ nodes, selection }) => {
        if (!$isRangeSelection(selection)) return false;
        if (
          !$findMatchingParent(selection.anchor.getNode(), $isQuoteNode) ||
          !$findMatchingParent(selection.focus.getNode(), $isQuoteNode) ||
          selection
            .getNodes()
            .some((node) => !$findMatchingParent(node, $isQuoteNode))
        ) {
          return false;
        }

        // Lexical merges only the first pasted paragraph into the current
        // block. Give the remaining paragraphs the same quote style before
        // its normal clipboard insertion, preserving their inline content.
        nodes.forEach((node, index) => {
          if ($isParagraphNode(node)) {
            nodes[index] = $createQuoteNode()
              .updateFromJSON(node.exportJSON())
              .append(...node.getChildren());
          }
        });
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (shiftDown) return false;
        if (event instanceof ClipboardEvent) {
          const clipboard = event.clipboardData;
          if (!clipboard) return false;
          // do not handle richer clipboards.
          // https://github.com/facebook/lexical/blob/main/packages/lexical-clipboard/src/clipboard.ts#L67
          if (clipboard.getData('application/x-lexical-editor')) {
            return false;
          }
          if (clipboard.getData('text/html')) {
            return false;
          }
          const pastedText = clipboard.getData('text/plain');
          if (!pastedText) {
            return false;
          }
          const selection = $getSelection();
          if (!selection) return false;

          event.preventDefault();
          setEditorStateFromMarkdown(parseEditor, pastedText, 'both');
          const state = parseEditor.getEditorState().toJSON();
          const nodes = state.root.children.map((node) =>
            $parseSerializedNode(node)
          );
          $insertGeneratedNodes(editor, nodes, selection);
        }
        return true;
      },
      COMMAND_PRIORITY_LOW
    ),
    () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    }
  );
}

export function markdownPastePlugin() {
  return (editor: LexicalEditor) => registerMarkdownPastePlugin(editor);
}
