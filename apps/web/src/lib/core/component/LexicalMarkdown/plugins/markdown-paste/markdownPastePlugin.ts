import { mergeRegister } from '@lexical/utils';
import {
  $insertNodes,
  $parseSerializedNode,
  COMMAND_PRIORITY_LOW,
  createEditor,
  type LexicalEditor,
  PASTE_COMMAND,
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
      PASTE_COMMAND,
      (event: InputEvent | ClipboardEvent) => {
        if (shiftDown) return false;
        if (event instanceof ClipboardEvent) {
          const clipboard = event.clipboardData;
          if (!clipboard) return false;
          // do not handle richer clipboards.
          if (clipboard.getData('application/x-lexical-clipboard')) {
            return false;
          }
          if (clipboard.getData('text/html')) {
            return false;
          }
          const pastedText = clipboard.getData('text/plain');
          if (!pastedText) {
            return false;
          }

          event.preventDefault();
          setEditorStateFromMarkdown(parseEditor, pastedText, 'both');
          const state = parseEditor.getEditorState().toJSON();
          const nodes = state.root.children.map((node) =>
            $parseSerializedNode(node)
          );
          $insertNodes(nodes);
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
