import type { CompatRuntime } from './runtime';
import type { PointType } from './selection';
import type { SelectionDOMRuntime } from './selection-methods';
import type {
  CompatDecoratorNode,
  CompatDOMRenderConfig,
  CompatEditor,
  CompatEditorState,
  CompatElementNode,
  CompatLineBreakNode,
  CompatNode,
  CompatRangeSelection,
  CompatRootNode,
  CompatTabNode,
  CompatTextNode,
} from './types';

/**
 * Exact internal call-subset manifest consumed by the declaration oracle.
 * Product modules depend on these interfaces, never the full core classes.
 * Traversal exposes only non-generic calls used here; the public core keeps its
 * complete upstream generics and is proved separately by the namespace oracle.
 * Explicit generic $getNodeByKey requests use the core's approved resolver.
 */
export type DOMInternalCallSubset = {
  node: CompatNode;
  element: CompatElementNode;
  text: CompatTextNode;
  decorator: CompatDecoratorNode;
  root: CompatRootNode;
  lineBreak: CompatLineBreakNode;
  tab: CompatTabNode;
  editor: CompatEditor;
  editorState: CompatEditorState;
  range: CompatRangeSelection;
  point: PointType;
  dom: CompatDOMRenderConfig;
  runtime: CompatRuntime;
  selectionRuntime: SelectionDOMRuntime;
};
