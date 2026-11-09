import { getActiveEditor } from './editor';
import { LineBreakNode, ParagraphNode, TextNode } from './nodes';

export type {
  CreateEditorArgs,
  EditorConfig,
  EditorDOMRenderConfig,
} from './editor';
export {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  createEditor,
  EditorState,
  getEditorDOMRenderConfig,
  getEditorDOMRenderConfig as $getEditorDOMRenderConfig,
  isCurrentlyReadOnlyMode,
  LexicalEditor,
} from './editor';
export {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
} from './nodes';

export function $createTextNode(text = ''): TextNode {
  return new TextNode(text);
}
export function $createParagraphNode(): ParagraphNode {
  return new ParagraphNode();
}
export function $createLineBreakNode(): LineBreakNode {
  return new LineBreakNode();
}
export function $isTextNode(value: unknown): value is TextNode {
  return value instanceof TextNode;
}
export function $isParagraphNode(value: unknown): value is ParagraphNode {
  return value instanceof ParagraphNode;
}
export function $isLineBreakNode(value: unknown): value is LineBreakNode {
  return value instanceof LineBreakNode;
}
export function $getEditor() {
  return getActiveEditor();
}
