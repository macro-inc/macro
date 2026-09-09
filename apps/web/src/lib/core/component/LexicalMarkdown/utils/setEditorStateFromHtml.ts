import { $generateNodesFromDOM } from '@lexical/html';
import {
  $createParagraphNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
  type ParagraphNode,
} from 'lexical';

/**
 * Set the editor state from an HTML string.
 * Uses Lexical's DOM import utilities to parse and insert nodes.
 * Mirrors the behavior of setEditorStateFromMarkdown by updating inside
 * an editor.update unless inUpdate is true.
 */
/**
 * The root only accepts block nodes. HTML whose top level is bare text or
 * inline elements (a plain-text string, `a<br>b`, a lone link) would otherwise
 * make `root.append` throw and the whole import be discarded, so runs of
 * inline nodes are gathered into paragraphs first.
 */
function $wrapInlineTopLevelNodes(nodes: LexicalNode[]): LexicalNode[] {
  const wrapped: LexicalNode[] = [];
  let paragraph: ParagraphNode | undefined;
  for (const node of nodes) {
    const isBlock =
      ($isElementNode(node) || $isDecoratorNode(node)) && !node.isInline();
    if (isBlock) {
      paragraph = undefined;
      wrapped.push(node);
      continue;
    }
    if (!paragraph) {
      paragraph = $createParagraphNode();
      wrapped.push(paragraph);
    }
    paragraph.append(node);
  }
  return wrapped;
}

function $replaceRootFromHtml(editor: LexicalEditor, html: string) {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const nodes = $wrapInlineTopLevelNodes($generateNodesFromDOM(editor, dom));
  const root = $getRoot();
  root.clear();
  root.append(...nodes);
}

export function setEditorStateFromHtml(
  editor: LexicalEditor,
  html: string,
  inUpdate = false
) {
  if (!inUpdate) {
    editor.update(() => {
      $replaceRootFromHtml(editor, html);
    });
    editor.read(() => {});
    return editor.getEditorState();
  } else {
    $replaceRootFromHtml(editor, html);
  }
}
