import {
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $isRootNode,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { editorStateAsMarkdown } from '../../utils';

// chars to include in context to AI
const CONTEXT_SIZE = 500;
const SELECTION = '[[SELECTION]]';
export function getContext(
  editor: LexicalEditor,
  headlessEditor: LexicalEditor,
  selection: RangeSelection
) {
  // transpose state from editor to headless editor
  const state = editor.getEditorState();
  headlessEditor.setEditorState(state);
  // find selected node
  headlessEditor.update(() => {
    const node = selection.anchor.getNode();
    const markerNode = $createTextNode(SELECTION);
    if ($isElementNode(node) && $isRootNode(node)) {
      node.insertAfter(markerNode);
    } else if ($isElementNode(node)) {
      const paragraph = $createParagraphNode();
      paragraph.append(markerNode);
      node.append(paragraph);
    } else {
      const [first] = node.splitText(selection.anchor.offset);
      first.insertAfter(markerNode);
    }
  });
  const md = editorStateAsMarkdown(headlessEditor);
  if (!md) return '';
  const [first, second] = md.split(SELECTION);
  if (first && !second) {
    return first.slice(-CONTEXT_SIZE) + SELECTION;
  }
  return first.slice(-CONTEXT_SIZE) + SELECTION + second.slice(0, CONTEXT_SIZE);
}
