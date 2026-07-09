import { $isCodeNode } from '@lexical/code';
import { $getRoot, $isTextNode, type EditorState } from 'lexical';

export type TailContext = {
  /* type of the deepest node at the very end of the document */
  nodeType: string;
  /* true when the tail is inside a fenced code block or inline code */
  inCode: boolean;
};

/**
 * Reports the node context at the very end of an already-parsed editor state —
 * the node streamed text is currently landing in. This is a read of existing
 * state, not a parse: pair it with the state the message renderer already
 * maintains so stream-side heuristics (e.g. mention buffering) make the same
 * call the renderer made.
 */
export function tailContext(state: EditorState): TailContext {
  return state.read(() => {
    const tail = $getRoot().getLastDescendant();
    if (!tail) return { nodeType: 'root', inCode: false };
    const inCode =
      ($isTextNode(tail) && tail.hasFormat('code')) ||
      [tail, ...tail.getParents()].some($isCodeNode);
    return { nodeType: tail.getType(), inCode };
  });
}
